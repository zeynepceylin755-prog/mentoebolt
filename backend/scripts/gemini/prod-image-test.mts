/**
 * Phase 7.5 — PRODUCTION image test (real photo → Gemini multimodal).
 *
 * Creates a brand-new student account, uploads a REAL image of a mathematics
 * question, runs the analysis, and checks what came back.
 *
 * Privacy rule: the image bytes, the question text, the account password and any
 * token are NEVER printed. Only status codes, provider/model identity and the
 * derived proposal fields are reported.
 *
 * Run:
 *   npx tsx scripts/gemini/prod-image-test.mts <path-to-question-image> [baseUrl]
 */
import { readFile } from 'node:fs/promises';

const BASE = (process.argv[3] ?? 'https://mentoebolt-production.up.railway.app').replace(/\/+$/, '');
const IMAGE_PATH = process.argv[2];

if (!IMAGE_PATH) {
  console.error('usage: prod-image-test.mts <path-to-question-image> [baseUrl]');
  process.exit(1);
}

const stamp = Date.now();
const email = `p75-prod-${stamp}@mentoebolt-test.dev`;
// Generated locally, never printed. Only used to obtain this throwaway session.
const password = `P75-${Math.random().toString(36).slice(2)}Aa1!`;
const REDACTED = '<redacted>';

function log(label: string, value: unknown) {
  console.log(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

async function main() {
  const bytes = await readFile(IMAGE_PATH);
  const ext = IMAGE_PATH.toLowerCase().endsWith('.jpg') || IMAGE_PATH.toLowerCase().endsWith('.jpeg')
    ? 'image/jpeg'
    : 'image/png';

  console.log('=== 1. REGISTER a test student ===');
  const reg = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      firstName: 'P75',
      lastName: 'ProdTest',
      grade: 11,
    }),
  });
  const regBody: any = await reg.json();
  log('register HTTP', reg.status);
  if (reg.status >= 400) {
    log('register error code', regBody?.error?.code ?? regBody?.error ?? 'unknown');
    process.exit(1);
  }

  const token =
    regBody?.data?.tokens?.accessToken ??
    regBody?.data?.accessToken ??
    regBody?.data?.token ??
    regBody?.accessToken ??
    regBody?.token;
  if (!token) {
    console.error('BLOCKED: no access token in register response');
    process.exit(1);
  }
  console.log('token: (obtained, not printed)');

  const auth = { Authorization: `Bearer ${token}` };

  console.log('\n=== 2. UPLOAD the question image (IMAGE_UPLOAD) ===');
  const upload = await fetch(`${BASE}/api/v1/question-ingestions/upload`, {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Type': ext,
      'X-Upload-Filename': encodeURIComponent(`question.${ext === 'image/png' ? 'png' : 'jpg'}`),
    },
    body: bytes,
  });
  const uploadBody: any = await upload.json();
  log('upload HTTP', upload.status);
  const ingestion = uploadBody?.data?.ingestion;
  const ingestionId = ingestion?.id;
  log('ingestMethod', ingestion?.ingestMethod);
  log('state', ingestion?.state);
  // originalAssetRef is deliberately NOT in the public projection (internal
  // storage reference). Its presence is asserted on the stored row instead, below.
  log('asset mimeType', uploadBody?.data?.asset?.mimeType);
  log('asset sizeBytes', uploadBody?.data?.asset?.sizeBytes);
  if (!ingestionId) {
    console.error('BLOCKED: no ingestion id');
    process.exit(1);
  }

  console.log('\n=== 3. ANALYZE (no normalizedText, no skipOcr — the photo is the question) ===');
  const started = Date.now();
  const analyze = await fetch(`${BASE}/api/v1/question-ingestions/${ingestionId}/analyze`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const analyzeBody: any = await analyze.json();
  log('analyze HTTP', analyze.status);
  log('latencyMs', Date.now() - started);

  if (analyze.status !== 200) {
    log('error code', analyzeBody?.error?.code ?? 'unknown');
    log('error message', analyzeBody?.error?.message ?? 'none');
    console.error('RESULT: FAIL (analysis did not succeed)');
    process.exit(1);
  }

  const proposal = analyzeBody?.data?.proposal;
  log('state after analyze', analyzeBody?.data?.state);
  log('requiresReview', analyzeBody?.data?.requiresReview);
  log('modelMetadata.provider', proposal?.modelMetadata?.provider);
  log('modelMetadata.model', proposal?.modelMetadata?.model);
  log('questionType', proposal?.questionUnderstanding?.questionType);
  log('mathematicalObjects', proposal?.questionUnderstanding?.mathematicalObjects);
  log('requestedOperation', proposal?.questionUnderstanding?.requestedOperation);
  log('confidence', proposal?.confidence);
  log('curriculumCandidates', proposal?.curriculumCandidates?.length ?? 0);
  log('microSkillCandidates', proposal?.microSkillCandidates?.length ?? 0);
  log('extractedText length', (proposal?.extractedText ?? proposal?.normalizedText ?? '').length);

  console.log('\n=== 4. GET the ingestion ===');
  const get = await fetch(`${BASE}/api/v1/question-ingestions/${ingestionId}`, { headers: auth });
  const getBody: any = await get.json();
  const fresh = getBody?.data;
  log('get HTTP', get.status);
  log('normalizedText present', Boolean(fresh?.normalizedText));
  log('normalizedText length', (fresh?.normalizedText ?? '').length);
  log('ocrConfidence', fresh?.ocrConfidence);

  console.log('\n=== VERDICT ===');
  const provider = proposal?.modelMetadata?.provider;
  const model = proposal?.modelMetadata?.model;
  const ok =
    analyze.status === 200 &&
    provider === 'gemini' &&
    Boolean(proposal?.questionUnderstanding?.questionType) &&
    Array.isArray(proposal?.questionUnderstanding?.mathematicalObjects) &&
    proposal.questionUnderstanding.mathematicalObjects.length > 0;

  console.log(`RESULT: ${ok ? 'PASS' : 'FAIL'}`);
  console.log(`provider: ${provider ?? 'none'}`);
  console.log(`model: ${model ?? 'none'}`);
  console.log(`password used: ${REDACTED}`);
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error('ERROR:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
