import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

import bootstrap from '../../src/index.js';
import { prisma } from '../setup.js';
import { TokenService } from '../../src/domain/services/TokenService.js';
import { LocalDevStorageProvider, toRef, fromRef } from '../../src/infrastructure/storage/LocalDevStorageProvider.js';
import { AssetUploadService } from '../../src/application/services/ingestion/AssetUploadService.js';
import {
  validateUpload,
  sniffMimeType,
  ALLOWED_UPLOAD_MIME_TYPES,
} from '../../src/domain/ingestion/uploadValidation.js';
import { InvalidUploadError } from '../../src/domain/errors/IngestionErrors.js';
import { INGESTION_STATES } from '../../src/domain/ingestion/ingestionStateMachine.js';

/**
 * Phase 5F.8 (C) — Minimal file upload + storage.
 *
 * Covers validation (type/size/empty/content-sniffing), safe local storage
 * (hash-based names, no path traversal), content hashing, and the browser→
 * storage→ingestion integration. OCR is NOT exercised here: the upload path must
 * not call it.
 */

const tokenService = new TokenService();

/** Real minimal PNG bytes (8-byte signature + IHDR start). */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PDF_BYTES = Buffer.from('%PDF-1.4\n%%EOF');
const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
]);

async function createStudent(label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const user = await prisma.user.create({
    data: { email, firstName: label, lastName: 'User', role: 'STUDENT', passwordHash: 'hash' },
  });
  await prisma.studentProfile.create({ data: { userId: user.id, grade: 11, school: 'S' } });
  const token = tokenService.generateAccessToken({ userId: user.id, email, role: 'STUDENT' });
  return { user, token };
}

describe('Phase 5F.8 (C) — upload validation (pure)', () => {
  it('accepts each allowed type when declared type matches the content', () => {
    expect(validateUpload(PNG_BYTES, 'image/png', 1024).valid).toBe(true);
    expect(validateUpload(JPEG_BYTES, 'image/jpeg', 1024).valid).toBe(true);
    expect(validateUpload(PDF_BYTES, 'application/pdf', 1024).valid).toBe(true);
    expect(validateUpload(WEBP_BYTES, 'image/webp', 1024).valid).toBe(true);
  });

  it('rejects an empty file', () => {
    const r = validateUpload(Buffer.alloc(0), 'image/png', 1024);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('EMPTY_FILE');
  });

  it('rejects an unsupported MIME type', () => {
    const r = validateUpload(PNG_BYTES, 'text/plain', 1024);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('UNSUPPORTED_MIME_TYPE');
  });

  it('rejects an oversized file', () => {
    const r = validateUpload(PNG_BYTES, 'image/png', 4);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('OVERSIZED');
  });

  it('rejects a declared type that does not match the real content (sniffing)', () => {
    // Claims PDF, is actually a PNG.
    const r = validateUpload(PNG_BYTES, 'application/pdf', 1024);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('CONTENT_TYPE_MISMATCH');
  });

  it('detects content signatures directly', () => {
    expect(sniffMimeType(PNG_BYTES)).toBe('image/png');
    expect(sniffMimeType(JPEG_BYTES)).toBe('image/jpeg');
    expect(sniffMimeType(PDF_BYTES)).toBe('application/pdf');
    expect(sniffMimeType(WEBP_BYTES)).toBe('image/webp');
    expect(sniffMimeType(Buffer.from('not a real file'))).toBeNull();
  });

  it('exposes exactly the four allowed types', () => {
    expect([...ALLOWED_UPLOAD_MIME_TYPES]).toEqual([
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/pdf',
    ]);
  });
});

describe('Phase 5F.8 (C) — local dev storage provider', () => {
  let dir: string;
  let provider: LocalDevStorageProvider;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'p5f8-storage-'));
    provider = new LocalDevStorageProvider(dir);
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('stores bytes and returns an opaque ref with a SHA-256 content hash', async () => {
    const stored = await provider.store({ data: PNG_BYTES, mimeType: 'image/png', extension: 'png' });
    const expectedHash = createHash('sha256').update(PNG_BYTES).digest('hex');

    expect(stored.contentHash).toBe(expectedHash);
    expect(stored.ref).toBe(`local://${expectedHash}.png`);
    expect(stored.sizeBytes).toBe(PNG_BYTES.byteLength);

    // Readback matches.
    const read = await provider.read(stored.ref);
    expect(read).not.toBeNull();
    expect(Buffer.compare(read!, PNG_BYTES)).toBe(0);
  });

  it('does not use the user filename as a path and rejects traversal refs', async () => {
    // A traversal-looking ref is refused (returns null / false).
    expect(fromRef('local://../../etc/passwd')).toBeNull();
    expect(await provider.read('local://../../etc/passwd')).toBeNull();
    expect(await provider.delete('local://../escape')).toBe(false);

    // A non-local ref is not readable through the local provider.
    expect(await provider.read('s3://bucket/key')).toBeNull();
  });

  it('deletes a stored asset', async () => {
    const stored = await provider.store({ data: JPEG_BYTES, mimeType: 'image/jpeg', extension: 'jpg' });
    expect(await provider.delete(stored.ref)).toBe(true);
    expect(await provider.read(stored.ref)).toBeNull();
  });

  it('keeps the ref out of the filesystem namespace (opaque, not a path)', () => {
    expect(toRef('abc.png')).toBe('local://abc.png');
    expect(fromRef('local://abc.png')).toBe('abc.png');
    expect(fromRef('plain-path.png')).toBeNull();
  });
});

describe('Phase 5F.8 (C) — AssetUploadService', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'p5f8-upload-'));
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('validates before storing and throws InvalidUploadError for bad input', async () => {
    const service = new AssetUploadService(new LocalDevStorageProvider(dir), 1024);
    await expect(
      service.storeUpload({ data: Buffer.alloc(0), declaredMimeType: 'image/png' })
    ).rejects.toBeInstanceOf(InvalidUploadError);
    await expect(
      service.storeUpload({ data: PNG_BYTES, declaredMimeType: 'text/plain' })
    ).rejects.toBeInstanceOf(InvalidUploadError);
  });

  it('stores a valid upload and returns a secure ref + hash', async () => {
    const service = new AssetUploadService(new LocalDevStorageProvider(dir), 1024);
    const asset = await service.storeUpload({
      data: PDF_BYTES,
      declaredMimeType: 'application/pdf',
      originalFilename: 'my scan.pdf',
    });
    expect(asset.ref.startsWith('local://')).toBe(true);
    expect(asset.mimeType).toBe('application/pdf');
    expect(asset.contentHash).toHaveLength(64);
  });
});

describe('Phase 5F.8 (C) — upload → ingestion over HTTP', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await bootstrap();
  });

  beforeEach(async () => {
    await prisma.questionInstance.deleteMany({});
    await prisma.questionIngestion.deleteMany({});
    await prisma.questionSource.deleteMany({});
    await prisma.studentProfile.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it('accepts a PNG upload, stores it and creates an ingestion with an asset ref', async () => {
    const student = await createStudent('c-upload');

    const res = await request(app)
      .post('/api/v1/question-ingestions/upload')
      .set('Authorization', `Bearer ${student.token}`)
      .set('Content-Type', 'image/png')
      .set('X-Upload-Filename', encodeURIComponent('scan.png'))
      .send(PNG_BYTES);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ingestion.state).toBe(INGESTION_STATES.INGESTED);
    expect(res.body.data.asset.contentHash).toHaveLength(64);

    // The persisted ingestion keeps provenance-neutral defaults: the asset ref
    // is opaque and origin/trust are NOT set by upload metadata.
    const stored = await prisma.questionIngestion.findUnique({
      where: { id: res.body.data.ingestion.id },
    });
    expect(stored!.originalAssetRef?.startsWith('local://')).toBe(true);
    expect(stored!.ingestedByUserId).toBe(student.user.id);

    // The asset ref never leaks into the API response.
    expect(JSON.stringify(res.body)).not.toContain('local://');
  });

  it('rejects a disallowed type over HTTP (400)', async () => {
    const student = await createStudent('c-bad-type');
    const res = await request(app)
      .post('/api/v1/question-ingestions/upload')
      .set('Authorization', `Bearer ${student.token}`)
      .set('Content-Type', 'text/plain')
      .send(Buffer.from('hello'));
    expect(res.status).toBe(400);
  });

  it('rejects a content/declared-type mismatch over HTTP (400)', async () => {
    const student = await createStudent('c-mismatch');
    const res = await request(app)
      .post('/api/v1/question-ingestions/upload')
      .set('Authorization', `Bearer ${student.token}`)
      .set('Content-Type', 'application/pdf')
      .set('X-Upload-Filename', 'fake.pdf')
      .send(PNG_BYTES);
    expect(res.status).toBe(400);
  });

  it('requires authentication for uploads', async () => {
    const res = await request(app)
      .post('/api/v1/question-ingestions/upload')
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);
    expect(res.status).toBe(401);
  });
});
