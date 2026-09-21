/**
 * Forensic check of the AUTH RESPONSE CONTRACT used by the frontend.
 *
 * The frontend reads the token from `data.data.tokens.accessToken` on login and
 * `data.data.accessToken` on refresh. This script verifies BOTH shapes against a
 * real backend response, structurally only — never printing a token value.
 *
 * Run: npx tsx scripts/auth/diag-auth-contract.mts [baseUrl]
 */
const BASE = (process.argv[2] ?? 'https://mentoebolt-production.up.railway.app').replace(/\/+$/, '');
const API = `${BASE}/api/v1`;

function report(label: string, value: unknown) {
  console.log(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

/** Structural description of an object: key names and value TYPES only. */
function shape(value: unknown, depth = 0): Record<string, unknown> | string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value !== 'object') return typeof value;
  if (depth > 2) return 'object';
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = shape(v, depth + 1);
  }
  return out;
}

async function main() {
  const email = `contract-${Date.now()}@mentoebolt-test.dev`;
  const password = 'Str0ngPass!2024';

  console.log('=== REGISTER ===');
  const reg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, firstName: 'Contract', lastName: 'Check', grade: 11 }),
  });
  report('register status', reg.status);
  const regBody: any = await reg.json();
  // Structure only — no values.
  report('register body shape', shape(regBody));
  report('data.tokens present', Boolean(regBody?.data?.tokens));
  report('data.tokens.accessToken is string', typeof regBody?.data?.tokens?.accessToken === 'string');
  report('data.tokens.refreshToken is string', typeof regBody?.data?.tokens?.refreshToken === 'string');
  report('data.accessToken (top level) is string', typeof regBody?.data?.accessToken === 'string');

  const refreshToken = regBody?.data?.tokens?.refreshToken;
  if (!refreshToken) {
    console.error('BLOCKED: cannot test refresh without a refresh token');
    return;
  }

  console.log('\n=== REFRESH ===');
  const ref = await fetch(`${API}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  report('refresh status', ref.status);
  const refBody: any = await ref.json();
  report('refresh body shape', shape(refBody));
  // The apiClient reads exactly these two paths:
  const pathA = refBody?.data?.accessToken;
  const pathB = refBody?.accessToken;
  report('apiClient path data.data.accessToken is string', typeof pathA === 'string');
  report('alt path data.accessToken is string', typeof pathB === 'string');

  const newAccess = typeof pathA === 'string' ? pathA : pathB;
  const newRefresh = refBody?.data?.refreshToken ?? refBody?.refreshToken;
  report('refresh returns a new refreshToken', typeof newRefresh === 'string');
  report('new refreshToken differs from old', typeof newRefresh === 'string' && newRefresh !== refreshToken);

  console.log('\n=== USE REFRESHED TOKEN on the three failing endpoints ===');
  for (const path of ['/question-attempts', '/recommendations/next', '/analytics/me/skills']) {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${newAccess}` },
    });
    report(`${path} status`, res.status);
  }

  console.log('\n=== RE-USE THE OLD refreshToken (rotation check) ===');
  const reuse = await fetch(`${API}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  report('reusing the consumed refreshToken status', reuse.status);
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
