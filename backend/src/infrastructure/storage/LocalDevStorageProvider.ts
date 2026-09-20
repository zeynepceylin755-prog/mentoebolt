import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  IStorageProvider,
  StoreInput,
  StoredAsset,
} from '../../domain/interfaces/storage/IStorageProvider.js';

/**
 * LocalDevStorageProvider — Phase 5F.8 (C2)
 *
 * Filesystem-backed storage for local development. Requires no S3/AWS or any
 * external service. The storage root is configurable; when it is not supplied
 * the caller must provide one (see getUploadDir / bootstrap wiring).
 *
 * Safety properties:
 *   - the on-disk name is derived from the CONTENT HASH, never the user filename,
 *     so a malicious filename can never influence a path;
 *   - the resolved path is re-checked to stay inside the root (path-traversal
 *     defence in depth);
 *   - the stored `ref` is opaque (`local://<hash>.<ext>`), so callers never see
 *     or handle a real filesystem path.
 */
export class LocalDevStorageProvider implements IStorageProvider {
  private readonly provider = 'local-dev';
  private readonly root: string;

  constructor(rootDir: string) {
    if (!rootDir || rootDir.trim().length === 0) {
      throw new Error('LocalDevStorageProvider requires a storage root directory');
    }
    this.root = path.resolve(rootDir);
  }

  getProviderName(): string {
    return this.provider;
  }

  async store(input: StoreInput): Promise<StoredAsset> {
    if (!Buffer.isBuffer(input.data)) {
      throw new Error('LocalDevStorageProvider.store requires a Buffer');
    }

    const contentHash = createHash('sha256').update(input.data).digest('hex');
    const objectName = `${contentHash}.${sanitizeExtension(input.extension)}`;
    const absolutePath = this.resolveObjectPath(objectName);

    try {
      await fs.mkdir(this.root, { recursive: true });
      await fs.writeFile(absolutePath, input.data);
    } catch (error) {
      // Phase 7.3 - Production safety: Railway filesystem is ephemeral.
      // Provide a clear error message if directory creation or write fails.
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Storage write failed at ${this.root}: ${errorMessage}. ` +
        'If running on Railway/ephemeral storage, consider using a persistent storage provider.'
      );
    }

    return {
      ref: toRef(objectName),
      mimeType: input.mimeType,
      sizeBytes: input.data.byteLength,
      contentHash,
    };
  }

  async read(ref: string): Promise<Buffer | null> {
    const objectName = fromRef(ref);
    if (!objectName) {
      return null;
    }
    try {
      return await fs.readFile(this.resolveObjectPath(objectName));
    } catch {
      return null;
    }
  }

  async delete(ref: string): Promise<boolean> {
    const objectName = fromRef(ref);
    if (!objectName) {
      return false;
    }
    try {
      await fs.unlink(this.resolveObjectPath(objectName));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve an object name to an absolute path, guaranteeing the result stays
   * inside the storage root. `objectName` is always server-generated (a hash +
   * extension), but the containment check keeps the invariant even if a caller
   * ever misuses this method.
   */
  private resolveObjectPath(objectName: string): string {
    const resolved = path.resolve(this.root, objectName);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (resolved !== this.root && !resolved.startsWith(rootWithSep)) {
      throw new Error('Resolved storage path escapes the storage root');
    }
    return resolved;
  }
}

const REF_PREFIX = 'local://';

/** Build the opaque reference persisted on the ingestion. */
export function toRef(objectName: string): string {
  return `${REF_PREFIX}${objectName}`;
}

/** Extract the object name from an opaque reference, or null if not one. */
export function fromRef(ref: string): string | null {
  if (typeof ref !== 'string' || !ref.startsWith(REF_PREFIX)) {
    return null;
  }
  const objectName = ref.slice(REF_PREFIX.length);
  if (objectName.length === 0) {
    return null;
  }
  // The object name is a single path segment: reject separators and traversal.
  if (objectName.includes('/') || objectName.includes('\\') || objectName.includes('..')) {
    return null;
  }
  return objectName;
}

/** Keep only a safe, known extension token; anything else becomes 'bin'. */
function sanitizeExtension(extension: string): string {
  const cleaned = String(extension ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned.length > 0 && cleaned.length <= 8 ? cleaned : 'bin';
}
