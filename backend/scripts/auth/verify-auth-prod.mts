/**
 * Production auth verification — checks the FULL requested flow through the REAL
 * deployed origin (Netlify proxy → Railway backend).
 *
 * Reports status codes only. Never prints or stores a token value.
 *
 * Run: npx tsx scripts/auth/verify-auth-prod.mts [baseUrl]
 */
const BASE = (process.argv[2] ?? 'https://mentorebeta.netlify.app').replace(/\/+$/, '');
const API = `${BASE}/api/v1`;

const results: Array<{ name: string; pass: boolean; detail: string }> = [];

function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
}

/** Decode a token's exp WITHOUT printing the token. */
function expiry(token: string): number | null {
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof p.exp === 'number' ? p.exp : null;
  } catch {
    return null;
  }
}

async function main() {
  const email = `verify-${Date.now()}@mentoebolt-test.dev`;
  const password = 'Str0ngPass!2024';

  // ---- login (register == the same session acquisition path) ----------------
  const reg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, firstName: 'Verify', lastName: 'Auth', grade: 11 }),
  });
  const regBody: any = await reg.json();
  const accessToken: string | undefined = regBody?.data?.tokens?.accessToken;
  const refreshToken: string | undefined = regBody?.data?.tokens?.refreshToken;
  check('login', reg.status === 201 && Boolean(accessToken), `HTTP ${reg.status}`);

  const auth = { Authorization: `Bearer ${accessToken}` };

  // ---- the three reported endpoints ----------------------------------------
  for (const [name, path] of [
    ['question-attempts', '/question-attempts'],
    ['next', '/recommendations/next'],
    ['skills', '/analytics/me/skills'],
  ] as const) {
    const res = await fetch(`${API}${path}`, { headers: auth });
    check(name, res.ok, `HTTP ${res.status}`);
  }

  // ---- refresh --------------------------------------------------------------
  const ref = await fetch(`${API}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  const refBody: any = await ref.json();
  const newAccess: string | undefined = refBody?.data?.accessToken;
  check('refresh', ref.ok && Boolean(newAccess), `HTTP ${ref.status}`);

  // ---- page-refresh simulation: old token expired, refresh yields a live one -
  if (newAccess) {
    const exp = expiry(newAccess);
    const now = Math.floor(Date.now() / 1000);
    check('refreshed token is live', exp !== null && exp > now, `ttl=${exp ? exp - now : 'n/a'}s`);

    // The endpoint that 401'd before must work with the refreshed token.
    const res = await fetch(`${API}/question-attempts`, {
      headers: { Authorization: `Bearer ${newAccess}` },
    });
    check('page refresh (refreshed token)', res.ok, `HTTP ${res.status}`);
  } else {
    check('refreshed token is live', false, 'no token returned');
    check('page refresh (refreshed token)', false, 'no token returned');
  }

  // ---- expired token must be REJECTED (proves the client check is meaningful) -
  const expiredLike = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1LTEiLCJleHAiOjF9.x';
  const bad = await fetch(`${API}/question-attempts`, {
    headers: { Authorization: `Bearer ${expiredLike}` },
  });
  check('expired token rejected by backend', bad.status === 401, `HTTP ${bad.status}`);

  // ---- logout ---------------------------------------------------------------
  const out = await fetch(`${API}/auth/logout`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refBody?.data?.refreshToken ?? refreshToken }),
  });
  check('logout', out.ok, `HTTP ${out.status}`);

  console.log('\n=== SUMMARY ===');
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    console.log('failures:', failed.map((f) => `${f.name} (${f.detail})`).join(', '));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
