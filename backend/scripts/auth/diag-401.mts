/**
 * Forensic auth diagnostic against production.
 *
 * Reports ONLY structural booleans and the backend's rejection reason.
 * Never prints a token, secret, email, or header value.
 *
 * Run: npx tsx scripts/auth/diag-401.mts [baseUrl]
 */
const BASE = (process.argv[2] ?? 'https://mentoebolt-production.up.railway.app').replace(/\/+$/, '');
const API = `${BASE}/api/v1`;

function report(label: string, value: unknown) {
  console.log(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

async function main() {
  console.log('=== A. UNAUTHENTICATED request (baseline) ===');
  for (const path of ['/question-attempts', '/recommendations/next', '/analytics/me/skills']) {
    const res = await fetch(`${API}${path}`);
    let reason = 'none';
    try {
      const body: any = await res.json();
      reason = body?.error?.code ?? body?.error?.message ?? 'unknown';
    } catch {
      reason = 'non-json body';
    }
    report(`${path} status`, res.status);
    report(`${path} reason`, reason);
  }

  console.log('\n=== B. MALFORMED token (header present, token garbage) ===');
  for (const path of ['/question-attempts', '/recommendations/next', '/analytics/me/skills']) {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    let reason = 'none';
    try {
      const body: any = await res.json();
      reason = body?.error?.code ?? body?.error?.message ?? 'unknown';
    } catch {
      reason = 'non-json body';
    }
    report(`${path} status`, res.status);
    report(`${path} reason`, reason);
  }

  console.log('\n=== C. REGISTER a throwaway account, then call all three with a REAL token ===');
  const stamp = Date.now();
  const email = `diag401-${stamp}@mentoebolt-test.dev`;
  const password = 'Str0ngPass!2024';

  const reg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, firstName: 'Diag', lastName: '401', grade: 11 }),
  });
  report('register status', reg.status);
  if (reg.status >= 400) {
    const b: any = await reg.json().catch(() => null);
    report('register reason', b?.error?.code ?? 'unknown');
    return;
  }

  const regBody: any = await reg.json();
  const accessToken: string | undefined = regBody?.data?.tokens?.accessToken;
  const refreshToken: string | undefined = regBody?.data?.tokens?.refreshToken;

  // Structural check only — never the value.
  report('accessToken present', Boolean(accessToken));
  report('refreshToken present', Boolean(refreshToken));
  if (accessToken) {
    const parts = accessToken.split('.');
    report('accessToken is 3-part JWT', parts.length === 3);
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      // Claim NAMES only, never values.
      report('accessToken claim names', Object.keys(payload).sort());
      report('has userId claim', typeof payload.userId === 'string');
      report('has exp claim', typeof payload.exp === 'number');
      if (typeof payload.exp === 'number') {
        const secsLeft = payload.exp - Math.floor(Date.now() / 1000);
        report('token expires in (s)', secsLeft);
        report('token expired', secsLeft <= 0);
      }
    } catch {
      report('accessToken payload decodable', false);
    }
  }

  console.log('\n=== D. AUTHENTICATED requests ===');
  for (const path of ['/question-attempts', '/recommendations/next', '/analytics/me/skills']) {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    let reason = 'none';
    try {
      const body: any = await res.json();
      reason = res.ok ? 'ok' : (body?.error?.code ?? body?.error?.message ?? 'unknown');
    } catch {
      reason = 'non-json body';
    }
    report(`${path} status`, res.status);
    report(`${path} reason`, reason);
  }

  console.log('\n=== E. REFRESH flow ===');
  const ref = await fetch(`${API}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  report('refresh status', ref.status);
  if (ref.ok) {
    const rb: any = await ref.json();
    report('refresh returns accessToken', Boolean(rb?.data?.accessToken));
    report('refresh returns refreshToken', Boolean(rb?.data?.refreshToken));
    const after = await fetch(`${API}/question-attempts`, {
      headers: { Authorization: `Bearer ${rb.data.accessToken}` },
    });
    report('question-attempts with refreshed token', after.status);
  }
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
