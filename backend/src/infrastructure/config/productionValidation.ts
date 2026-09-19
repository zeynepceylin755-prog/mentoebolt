/**
 * Production configuration validation — Phase 7.3
 *
 * Fails CLOSED: when NODE_ENV=production, the process refuses to start unless
 * every security-critical configuration value is genuinely provisioned. This is
 * deliberately separate from the zod schema in environment.ts, which supplies
 * convenient DEVELOPMENT defaults. Those defaults are safe for local work but
 * catastrophic in production (a committed JWT secret would sign real tokens).
 *
 * Design rules
 * - Development / test behaviour is unchanged: this module does nothing unless
 *   NODE_ENV === 'production'.
 * - Every problem is collected and reported together, so an operator fixes the
 *   whole configuration in one pass rather than one error per restart.
 * - The values themselves are NEVER echoed into the error message (no secret
 *   leakage into logs): only the variable NAME and the reason are reported.
 */

/** Values that ship in the repository and must never reach production. */
const INSECURE_SECRET_VALUES = new Set([
  'default-secret-key-change-this-in-production',
  'default-refresh-secret-change-this-in-production',
  'dev-secret-key-32-characters-minimum',
  'dev-refresh-secret-32-characters-minimum',
  'CHANGE_ME_32_CHAR_MINIMUM',
  'CHANGE_ME',
]);

/** Minimum JWT secret length (mirrors the zod schema). */
const MIN_SECRET_LENGTH = 32;

export interface ProductionValidationInput {
  NODE_ENV: string;
  JWT_SECRET?: string;
  JWT_REFRESH_SECRET?: string;
  DATABASE_URL?: string;
  CORS_ORIGIN?: string;
  // Provider selections (lower-case strings as read from env).
  OCR_PROVIDER?: string;
  QUESTION_UNDERSTANDING_PROVIDER?: string;
  ERROR_ANALYSIS_PROVIDER?: string;
  EXPLANATION_PROVIDER?: string;
  OPENAI_API_KEY?: string;
}

/** A provider that requires an API key and explicit egress to be usable. */
interface AgentRequirement {
  name: string;
  provider?: string;
  egressFlagName: string;
  egressFlag?: string;
}

/**
 * Validate production configuration. Returns the list of problems (empty when
 * the configuration is acceptable). Pure and side-effect free so it is directly
 * testable without touching process state.
 */
function isPlaceholderPostgresUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === 'postgresql://user:password@host:5432/mentora' ||
    normalized === 'postgres://user:password@host:5432/mentora' ||
    normalized.includes('user:password@host') ||
    normalized.includes('change_me') ||
    normalized.includes('replace_with_secure_password')
  );
}

function isPostgresUrl(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  return /^(postgresql|postgres):\/\//i.test(normalized);
}

export function collectProductionConfigProblems(
  input: ProductionValidationInput,
  envRaw: Record<string, string | undefined> = {}
): string[] {
  const problems: string[] = [];

  // --- JWT secrets -------------------------------------------------------
  checkSecret('JWT_SECRET', input.JWT_SECRET, problems);
  checkSecret('JWT_REFRESH_SECRET', input.JWT_REFRESH_SECRET, problems);

  // The access and refresh secrets must be distinct; sharing one key means a
  // refresh token could be replayed as an access token.
  if (
    input.JWT_SECRET &&
    input.JWT_REFRESH_SECRET &&
    input.JWT_SECRET === input.JWT_REFRESH_SECRET
  ) {
    problems.push('JWT_SECRET and JWT_REFRESH_SECRET must be different values');
  }

  // --- Database ----------------------------------------------------------
  const dbUrl = input.DATABASE_URL ?? '';
  if (!dbUrl || dbUrl.trim().length === 0) {
    problems.push('DATABASE_URL must be configured explicitly in production');
  } else {
    if (dbUrl.startsWith('file:')) {
      // A file-based SQLite database is not a production deployment target.
      problems.push('DATABASE_URL must point at a production database, not a file: SQLite URL');
    }
    if (!isPostgresUrl(dbUrl)) {
      problems.push('DATABASE_URL must use a PostgreSQL connection string in production');
    }
    if (isPlaceholderPostgresUrl(dbUrl)) {
      problems.push('DATABASE_URL must not be a placeholder production value');
    }
  }

  // --- CORS --------------------------------------------------------------
  const origins = (input.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (origins.length === 0) {
    problems.push('CORS_ORIGIN must list explicit production origins');
  }
  if (origins.includes('*')) {
    problems.push('CORS_ORIGIN must not contain "*" when credentials are enabled');
  }
  if (origins.some((o) => /localhost|127\.0\.0\.1/i.test(o))) {
    problems.push('CORS_ORIGIN must not contain local development origins in production');
  }

  // --- AI providers: real provider requires a key + explicit egress -------
  const agents: AgentRequirement[] = [
    {
      name: 'OCR',
      provider: input.OCR_PROVIDER,
      egressFlagName: 'OCR_ALLOW_EXTERNAL_PROVIDER',
      egressFlag: envRaw['OCR_ALLOW_EXTERNAL_PROVIDER'],
    },
    {
      name: 'Question Understanding',
      provider: input.QUESTION_UNDERSTANDING_PROVIDER,
      egressFlagName: 'QUESTION_UNDERSTANDING_ALLOW_EXTERNAL_PROVIDER',
      egressFlag: envRaw['QUESTION_UNDERSTANDING_ALLOW_EXTERNAL_PROVIDER'],
    },
    {
      name: 'Error Analysis',
      provider: input.ERROR_ANALYSIS_PROVIDER,
      egressFlagName: 'ERROR_ANALYSIS_ALLOW_EXTERNAL_PROVIDER',
      egressFlag: envRaw['ERROR_ANALYSIS_ALLOW_EXTERNAL_PROVIDER'],
    },
    {
      name: 'Explanation',
      provider: input.EXPLANATION_PROVIDER,
      egressFlagName: 'EXPLANATION_ALLOW_EXTERNAL_PROVIDER',
      egressFlag: envRaw['EXPLANATION_ALLOW_EXTERNAL_PROVIDER'],
    },
  ];

  for (const agent of agents) {
    if (agent.provider === 'openai') {
      if (!input.OPENAI_API_KEY || input.OPENAI_API_KEY.trim().length === 0) {
        problems.push(`${agent.name}: OPENAI_API_KEY must be configured for the real provider`);
      }
      if (String(agent.egressFlag).toLowerCase() !== 'true') {
        problems.push(
          `${agent.name}: ${agent.egressFlagName} must be explicitly "true" to permit external egress`
        );
      }
    }
  }

  return problems;
}

/**
 * In production, validate the parsed environment and throw when any security
 * critical value is missing or insecure. No-op outside production.
 */
export function assertProductionConfig(
  input: ProductionValidationInput,
  envRaw: Record<string, string | undefined> = process.env
): void {
  if (input.NODE_ENV !== 'production') {
    return;
  }

  const problems = collectProductionConfigProblems(input, envRaw);
  if (problems.length > 0) {
    // Names and reasons only — never the secret values themselves.
    throw new Error(
      'Production configuration is invalid. Refusing to start.\n' +
      problems.map((p) => `  - ${p}`).join('\n')
    );
  }
}

function checkSecret(name: string, value: string | undefined, problems: string[]): void {
  if (!value || value.trim().length === 0) {
    problems.push(`${name} must be explicitly set in production (no default is applied)`);
    return;
  }
  if (value.length < MIN_SECRET_LENGTH) {
    problems.push(`${name} must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (INSECURE_SECRET_VALUES.has(value)) {
    problems.push(`${name} is set to a well-known insecure default value`);
  }
}
