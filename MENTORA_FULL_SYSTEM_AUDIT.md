# MENTORA FULL SYSTEM AUDIT

## 1. Executive Summary

Mentora is a substantial application with real backend and frontend code, a Prisma schema, multiple AI provider layers, and a mature test suite. The codebase is not a simple mockup: the backend has production-oriented hardening, auth flows, idempotency, curriculum and session logic, and AI gateway abstractions. The key issue is not that it is entirely non-functional; it is that the repository is not validated as a real production deployment today.

What works:
- The backend test suite is substantial and currently passes under the repository’s actual scripts.
- The frontend test suite passes and the production Vite build succeeds.
- The backend TypeScript project compiles successfully in production build mode.
- The auth and AI layers include explicit safeguards against client-authoritative identity and answer injection.
- The database schema and learning-state services are structured around real persisted domain entities, not only UI state.

What partially works:
- The product has real application logic for auth, student sessions, question attempts, mastery, recommendations, and AI guidance.
- The AI routes and provider factory are designed with mock-by-default safety and real-provider gating.
- The code includes explicit “fail closed” config validation for production.

What is broken or not currently production-ready:
- Production AI is not active by default; the default provider is mock, and real-provider egress is intentionally disabled unless configured explicitly.
- Production deployment is blocked without a real database URL and valid production secrets; the repo’s example config still contains placeholder values and a file-based SQLite default in development logic.
- The frontend is deployed by Netlify as a static bundle, while the backend is a separate Node service; there is no verified end-to-end production deployment wiring in the repo that proves the frontend can reach a deployed backend instance.
- The app is designed around a real backend and explicit env configuration, but the repository does not prove that a real student can complete the full journey on a live production deployment today.

What prevents production launch:
- Real environment configuration is required for JWT secrets, a non-SQLite database, CORS origins, and AI provider credentials/egress gating.
- The backend and frontend are separated and require deployment orchestration; the repository demonstrates correct logic and buildability, not a live production stack.

---

## 2. Architecture Map

Frontend
↓
API layer / Vite frontend client
↓
Express backend server in [backend/src/index.ts](backend/src/index.ts)
↓
Application services (auth, assessment, learning, analytics, AI, ingestion)
↓
Prisma database access via [backend/prisma/schema.prisma](backend/prisma/schema.prisma)
↓
External services: OpenAI-compatible AI providers, file-storage for uploads, and production deployment targets (frontend Netlify, backend Node service)

Repository structure:
- Frontend app: [frontend/src](frontend/src)
- Backend app: [backend/src](backend/src)
- Prisma schema: [backend/prisma/schema.prisma](backend/prisma/schema.prisma)
- Netlify static hosting: [netlify.toml](netlify.toml)
- Backend startup and route wiring: [backend/src/index.ts](backend/src/index.ts)
- Auth middleware: [backend/src/api/middleware/auth.ts](backend/src/api/middleware/auth.ts)
- AI provider factory: [backend/src/infrastructure/ai/AIServiceFactory.ts](backend/src/infrastructure/ai/AIServiceFactory.ts)
- Frontend auth state: [frontend/src/contexts/AuthContext.tsx](frontend/src/contexts/AuthContext.tsx)
- Frontend API base: [frontend/src/lib/apiClient.ts](frontend/src/lib/apiClient.ts)

---

## 3. Test Results

Commands run and results observed:

- Backend tests: `cd /Users/zeynepceylindulger/Downloads/mentoebolt/backend && npx vitest --run --reporter=default`
  - Result: 39 test files passed, 869 tests passed, 0 failed, 0 skipped.
  - Duration: ~133.52s.

- Frontend tests: `cd /Users/zeynepceylindulger/Downloads/mentoebolt/frontend && npx vitest --run --reporter=default`
  - Result: 22 test files passed, 218 tests passed, 0 failed, 0 skipped.
  - Duration: ~3.56s.

- Frontend production build: `cd /Users/zeynepceylindulger/Downloads/mentoebolt/frontend && npm run build`
  - Result: PASS.
  - Evidence: Vite production build completed successfully and emitted dist assets.

- Backend production build: `cd /Users/zeynepceylindulger/Downloads/mentoebolt/backend && npm run build`
  - Result: PASS.
  - Evidence: `tsc` completed with exit code 0.

- Backend typecheck: no dedicated script exists in [backend/package.json](backend/package.json), but the production TypeScript build runs `tsc` and passed.
- Frontend typecheck: the build command includes `tsc --noEmit` and passed.

---

## 4. Critical Findings

### Finding 1
Severity: CRITICAL
File: [backend/src/infrastructure/config/environment.ts](backend/src/infrastructure/config/environment.ts), [backend/src/infrastructure/config/productionValidation.ts](backend/src/infrastructure/config/productionValidation.ts), [backend/.env.example](backend/.env.example)
Function/Route: `getEnv()`, `assertProductionConfig()`, `collectProductionConfigProblems()`
Problem: The application is intentionally fail-closed in production, but the repository still ships example values and defaults that are not valid for a real production deployment.
Expected: A production deployment should have non-placeholder JWT secrets, a production database URL, explicit CORS origins, and no local default values.
Observed: The env schema includes default placeholders such as `default-secret-key-change-this-in-production`, and [backend/.env.example](backend/.env.example) sets `NODE_ENV=production` while leaving placeholder values like `JWT_SECRET=CHANGE_ME_32_CHAR_MINIMUM` and `DATABASE_URL=postgresql://user:password@host:5432/mentora`.
Evidence: [backend/src/infrastructure/config/environment.ts](backend/src/infrastructure/config/environment.ts) and [backend/src/infrastructure/config/productionValidation.ts](backend/src/infrastructure/config/productionValidation.ts) explicitly reject insecure production config, which confirms that the default repo configuration is not deployment-ready.
Production impact: Production startup will fail until an operator sets real secrets and a non-SQLite database.

### Finding 2
Severity: CRITICAL
File: [backend/prisma/schema.prisma](backend/prisma/schema.prisma), [backend/src/infrastructure/config/productionValidation.ts](backend/src/infrastructure/config/productionValidation.ts)
Function/Route: Prisma datasource configuration, production validation
Problem: The default datasource is SQLite, which is explicitly rejected for production.
Expected: A real production deployment should use a production-grade database backend.
Observed: The Prisma datasource is `provider = "sqlite"` and `DATABASE_URL` defaults to `file:./dev.db` in the env schema. The production validation then rejects `file:` SQLite URLs as invalid for production.
Evidence: [backend/prisma/schema.prisma](backend/prisma/schema.prisma) and [backend/src/infrastructure/config/productionValidation.ts](backend/src/infrastructure/config/productionValidation.ts).
Production impact: The app cannot be launched against the default repo config in production; a real database must be provisioned and connected.

### Finding 3
Severity: CRITICAL
File: [backend/src/infrastructure/ai/config/AIConfig.ts](backend/src/infrastructure/ai/config/AIConfig.ts), [backend/src/infrastructure/ai/AIServiceFactory.ts](backend/src/infrastructure/ai/AIServiceFactory.ts), [backend/src/infrastructure/ai/providers/MockAIProvider.ts](backend/src/infrastructure/ai/providers/MockAIProvider.ts)
Function/Route: `getAIConfig()`, `AIServiceFactory.getProvider()`, `MockAIProvider.complete()`
Problem: Real AI is not active by default; the safe default is mock AI.
Expected: A production deployment should have a real provider active only after an explicit, validated configuration step.
Observed: `AI_PROVIDER` defaults to `mock`, and the factory explicitly rejects unsupported providers while creating a `MockAIProvider` for the default case. The real OpenAI provider only activates when the env has a valid key and the corresponding external-egress gate is enabled.
Evidence: [backend/src/infrastructure/ai/config/AIConfig.ts](backend/src/infrastructure/ai/config/AIConfig.ts), [backend/src/infrastructure/ai/AIServiceFactory.ts](backend/src/infrastructure/ai/AIServiceFactory.ts), and [backend/src/infrastructure/ai/providers/MockAIProvider.ts](backend/src/infrastructure/ai/providers/MockAIProvider.ts).
Production impact: There is no production AI enabled by default; a real deployment requires explicit configuration and egress approval.

### Finding 4
Severity: HIGH
File: [netlify.toml](netlify.toml), [frontend/src/lib/apiClient.ts](frontend/src/lib/apiClient.ts), [backend/src/index.ts](backend/src/index.ts)
Function/Route: Netlify static hosting, API client base URL, Express app mounting
Problem: The frontend is deployed as a static site on Netlify, but the backend is a separate service with no verified production deployment wiring in the repo.
Expected: Frontend and backend should have a proven production communication path, such as a reverse proxy or configured API base URL.
Observed: [netlify.toml](netlify.toml) publishes `frontend/dist` and rewrites every route to `/index.html`. [frontend/src/lib/apiClient.ts](frontend/src/lib/apiClient.ts) defaults to `/api/v1` when no injected build-time base is set, which is correct behind a reverse proxy but not a live proof of a deployed backend. The repo does not include a verified full-stack production deployment assembly.
Evidence: [netlify.toml](netlify.toml), [frontend/src/lib/apiClient.ts](frontend/src/lib/apiClient.ts), and [backend/src/index.ts](backend/src/index.ts).
Production impact: The frontend can be built and deployed, but the exact production backend reachability has not been proven by repo configuration alone.

---

## 5. High Priority Findings

### Finding 5
Severity: HIGH
File: [backend/package.json](backend/package.json), [backend/src/index.ts](backend/src/index.ts)
Function/Route: package scripts, TypeScript build
Problem: The backend package lacks a `typecheck` script even though the build runs `tsc` successfully.
Expected: A standard TypeScript project should expose a clear typecheck script for CI and local verification.
Observed: [backend/package.json](backend/package.json) has `build: "tsc"`, but no `typecheck` alias script.
Evidence: [backend/package.json](backend/package.json).
Production impact: This is a developer ergonomics and CI clarity issue; it does not by itself break runtime, but it weakens verification portability.

### Finding 6
Severity: HIGH
File: [frontend/src/components/SoruGetir.tsx](frontend/src/components/SoruGetir.tsx), [frontend/src/components/LandingPage.tsx](frontend/src/components/LandingPage.tsx)
Function/Route: `SoruGetir`, `LandingPage`
Problem: The frontend test output emits repeated React `act(...)` warnings.
Expected: React tests should wrap async state transitions in `act()` to avoid warnings and flaky behavior.
Observed: The Vitest output included repeated warnings stating that an update was not wrapped in `act(...)` during `SoruGetir` and `LandingPage` state transitions.
Evidence: Captured frontend test output from the Vitest run.
Production impact: This does not currently fail the suite, but it is a sign of asynchronous UI update risk and may impact test stability or user interactions under some conditions.

### Finding 7
Severity: HIGH
File: [backend/src/api/routes/aiRoutes.ts](backend/src/api/routes/aiRoutes.ts)
Function/Route: `createAIRoutes()`, `createCanonicalAIRoutes()`
Problem: There are historical and canonical AI route aliases, which increases complexity without necessarily adding value.
Expected: A clean API surface with a single canonical route should be maintained.
Observed: The code mounts both the legacy `/api/v1/ai/ai/...` route and the canonical `/api/v1/ai/...` routes.
Evidence: [backend/src/api/routes/aiRoutes.ts](backend/src/api/routes/aiRoutes.ts).
Production impact: Not a runtime blocker, but it increases maintenance and ambiguity for future API consumers.

---

## 6. Medium / Low Priority Findings

### Finding 8
Severity: MEDIUM
File: [frontend/src/App.tsx](frontend/src/App.tsx)
Function/Route: `AppContent()`, `StudentApp()`
Problem: The student app uses hash-based navigation instead of a standard router-driven SPA flow.
Expected: A production app can still use hash-based navigation, but it should be intentionally designed and not rely on standard route semantics for core flows.
Observed: The app reads and updates `window.location.hash` to drive Student destinations. This is a valid pattern, but it is not a standard path-based route model.
Evidence: [frontend/src/App.tsx](frontend/src/App.tsx).
Production impact: It is stable for the current app, but it reduces conventional route discoverability and makes deep-link semantics less standard than a path-based router.

### Finding 9
Severity: MEDIUM
File: [frontend/src/contexts/AuthContext.tsx](frontend/src/contexts/AuthContext.tsx)
Function/Route: `restoreSession()`
Problem: Session restoration trusts locally persisted token presence and parses a JWT to decide that a session is authenticated.
Expected: Restoration should rely on verified server-side session validity when possible, and it should fail closed for malformed/expired tokens.
Observed: `restoreSession()` checks for token presence and attempts to parse the access token to set `authenticated: true`. It then tries refresh if parsing fails. This is intentionally lightweight and not a direct authorization decision, but it is still local-only trust at the UI boundary.
Evidence: [frontend/src/contexts/AuthContext.tsx](frontend/src/contexts/AuthContext.tsx).
Production impact: This is acceptable for a client app as long as the backend enforces identity on every protected action. The backend does enforce this by deriving identity from the authenticated principal.

### Finding 10
Severity: LOW
File: [package.json](package.json), [frontend/package.json](frontend/package.json), [backend/package.json](backend/package.json)
Function/Route: repository package structure
Problem: There are multiple package roots and overlapping application areas, which increases risk of drift or confusion.
Expected: A single clear top-level project should be well-scoped and consistent.
Observed: The repo contains a root package, a frontend package, and a backend package with some duplicate logic and setup.
Evidence: [package.json](package.json), [frontend/package.json](frontend/package.json), and [backend/package.json](backend/package.json).
Production impact: Low today, but it increases maintenance overhead and deployment complexity.

---

## 7. Broken User Flows

### Flow: Real student sign-up and login in a production environment
Expected: A student can register, login, obtain tokens, access their session, and then complete a learning flow with persisted state.
Actual: The repo contains the code and tests to support this flow, but the system is not proven under a real production deployment because the required env and database configuration are not in place by default.
Root cause: Production environment, real database connectivity, and required AI/egress configuration are not guaranteed by default; the app is intentionally configured to fail closed when production values are missing.
Affected files:
- [backend/src/application/services/auth/AuthService.ts](backend/src/application/services/auth/AuthService.ts)
- [backend/src/api/middleware/auth.ts](backend/src/api/middleware/auth.ts)
- [backend/src/infrastructure/config/environment.ts](backend/src/infrastructure/config/environment.ts)
- [backend/src/infrastructure/config/productionValidation.ts](backend/src/infrastructure/config/productionValidation.ts)

### Flow: AI-guided question analysis / explanation / recommendation in production
Expected: A real AI provider should become active only when explicitly approved and configured.
Actual: The default model is mock, and strong gating requires `OPENAI_API_KEY` plus the corresponding external provider flag to be set to `true`.
Root cause: The architecture is intentionally safe-by-default and therefore does not claim production AI activation without explicit environment setup.
Affected files:
- [backend/src/infrastructure/ai/config/AIConfig.ts](backend/src/infrastructure/ai/config/AIConfig.ts)
- [backend/src/infrastructure/ai/AIServiceFactory.ts](backend/src/infrastructure/ai/AIServiceFactory.ts)
- [backend/src/infrastructure/ai/providers/OpenAIProvider.ts](backend/src/infrastructure/ai/providers/OpenAIProvider.ts)

### Flow: Full-stack deployment narrative from Netlify to backend API
Expected: Frontend deployed on Netlify should reach the backend API through a controlled path.
Actual: The repo contains backend code and frontend code, but a verified live deployment pipeline is not included in the repository artifact itself.
Root cause: The build configuration is split between static Netlify hosting and a separate backend service without a single assembled production deployment manifest.
Affected files:
- [netlify.toml](netlify.toml)
- [backend/src/index.ts](backend/src/index.ts)
- [frontend/src/lib/apiClient.ts](frontend/src/lib/apiClient.ts)

---

## 8. Security Findings

### Confirmed vulnerabilities
None confirmed from the static audit and test evidence. The codebase explicitly hardens several risky areas, including: 
- route-level authentication checks in [backend/src/api/middleware/auth.ts](backend/src/api/middleware/auth.ts)
- identity derivation from the authenticated principal rather than the request body in [backend/src/api/controllers/AIController.ts](backend/src/api/controllers/AIController.ts)
- fail-closed production config validation in [backend/src/infrastructure/config/productionValidation.ts](backend/src/infrastructure/config/productionValidation.ts)
- AI explanation safety policies in [backend/src/application/services/ai/AIExplanationService.ts](backend/src/application/services/ai/AIExplanationService.ts)
- deterministic answer evaluation and guard rails in [backend/src/application/services/learning/QuestionAttemptService.ts](backend/src/application/services/learning/QuestionAttemptService.ts)

### Potential risks requiring further verification
- Production config remains the main risk until real secrets and a real database are provisioned.
- External AI egress is intentionally gated and should be validated in a live deployment environment before real student data is sent externally.
- The app’s static front-end and separate backend require a real deployment topology and reverse-proxy verification before production use.

---

## 9. AI Readiness

Mock AI:
- [backend/src/infrastructure/ai/providers/MockAIProvider.ts](backend/src/infrastructure/ai/providers/MockAIProvider.ts)
- Default config in [backend/src/infrastructure/ai/config/AIConfig.ts](backend/src/infrastructure/ai/config/AIConfig.ts)

Real AI:
- [backend/src/infrastructure/ai/providers/OpenAIProvider.ts](backend/src/infrastructure/ai/providers/OpenAIProvider.ts)
- Selected by [backend/src/infrastructure/ai/AIServiceFactory.ts](backend/src/infrastructure/ai/AIServiceFactory.ts)

Production readiness:
- Not ready by default. Real AI requires explicit env values and egress gating.
- The code is designed to fail closed and avoid accidental external data sending.

Failure handling:
- OpenAI retries transient failures and then throws an error if all attempts fail.
- The real-provider safety tests explicitly validate bad output, timeout, and egress gating behaviors in [backend/tests/integration/phase-7-1-real-ai-production.test.ts](backend/tests/integration/phase-7-1-real-ai-production.test.ts).

AI authority boundary:
- The backend is authoritative for scoring and mastery. This is explicitly documented in the code and enforced in evaluation services such as [backend/src/application/services/learning/QuestionAttemptService.ts](backend/src/application/services/learning/QuestionAttemptService.ts).
- The AI layers are intentionally not allowed to decide correctness or mastery; they provide guidance only.

---

## 10. Production Readiness Matrix

| Area | Status | Evidence | Blocking? |
| --- | --- | --- | --- |
| Frontend | PASS WITH WARNINGS | Frontend Vitest passes; Vite build passes. | No |
| Backend | PASS WITH WARNINGS | Backend tests pass; build passes. | No |
| Authentication | PASS | Auth service, middleware, and tests show real token validation and session handling. | No |
| Authorization | PASS | Identity is derived from authenticated principal; client-side override is ignored. | No |
| Database | PARTIAL | Prisma schema and service logic are solid, but SQLite is default and rejected in production. | Yes |
| API contracts | PASS | Routes and schemas are structured and validated. | No |
| Learning state | PASS | Persisted state logic and tests exist. | No |
| Assessment | PASS | Deterministic answer evaluation and tests exist. | No |
| Question solving | PASS | Evaluation and validation logic exist. | No |
| Error analysis | PASS | Service and tests cover error classification and safety boundaries. | No |
| Mastery | PASS | Mastery logic is persisted and tests exercise it. | No |
| Progress | PASS | Progress service exists and tests validate key flows. | No |
| Recommendations | PASS | Non-authoritative AI recommendation path is isolated. | No |
| Curriculum | PARTIAL | Curriculum and skill mapping exist, but real deployment proof is still required. | No |
| AI integration | PARTIAL | Real provider exists, but default config is mock and production gating is required. | Yes |
| Idempotency | PASS | Tests explicitly cover repeated requests and dedup logic. | No |
| Security | PASS WITH WARNINGS | Hardening exists, but production env and external egress must be verified. | Yes |
| Error handling | PASS | Error handler and validation patterns are present. | No |
| Testing | PASS | Real suites pass. | No |
| Deployment | PARTIAL | Frontend build succeeds; backend deployment requires real environment + database. | Yes |
| Production configuration | FAIL | Placeholder production secrets and SQLite defaults are not deployment-ready. | Yes |

---

## 11. Launch Blockers

Only the issues that genuinely block production launch are listed below:

1. Production secrets and environment configuration are not valid by default.
2. Prisma uses SQLite by default; production validation explicitly rejects file-based SQLite.
3. Real AI is disabled unless explicitly configured and egress-approved.
4. There is no proven real end-to-end production deployment topology for the frontend + backend stack.

---

## 12. Recommended Fix Order

1. Define and provision real production environment values for JWT secrets, database URL, CORS origins, and AI credentials.
2. Switch the deployment database to a real production-capable database, not SQLite.
3. Configure the real AI provider only after proving egress, credential, and failure handling requirements in the production environment.
4. Verify the frontend-to-backend production topology using reverse-proxy or equivalent deployment configuration.
5. Run full environment validation and smoke tests against the real deployed stack.
6. Finish deployment hardening and production monitoring before customer-facing launch.

---

## 13. What Is Already Solid

The following areas are the strongest and least likely to need rewrite:

- Authentication and protected-route patterns are implemented with explicit route-level validation. See [backend/src/api/middleware/auth.ts](backend/src/api/middleware/auth.ts) and [backend/src/application/services/auth/AuthService.ts](backend/src/application/services/auth/AuthService.ts).
- Deterministic attempt evaluation is in place in [backend/src/application/services/learning/QuestionAttemptService.ts](backend/src/application/services/learning/QuestionAttemptService.ts).
- AI surfaces are explicitly separated from authoritative decision-making. See [backend/src/api/controllers/AIController.ts](backend/src/api/controllers/AIController.ts) and the provider factory.
- The test suite is substantial and currently passes.
- The frontend and backend both compile and build successfully under the repository’s actual scripts.

---

## 14. Files Examined

Important inspected files and directories:

- [netlify.toml](netlify.toml)
- [package.json](package.json)
- [frontend/package.json](frontend/package.json)
- [backend/package.json](backend/package.json)
- [frontend/src](frontend/src)
- [backend/src](backend/src)
- [backend/prisma/schema.prisma](backend/prisma/schema.prisma)
- [backend/src/index.ts](backend/src/index.ts)
- [backend/src/api/middleware/auth.ts](backend/src/api/middleware/auth.ts)
- [backend/src/infrastructure/config/environment.ts](backend/src/infrastructure/config/environment.ts)
- [backend/src/infrastructure/config/productionValidation.ts](backend/src/infrastructure/config/productionValidation.ts)
- [backend/src/infrastructure/ai/AIServiceFactory.ts](backend/src/infrastructure/ai/AIServiceFactory.ts)
- [backend/src/infrastructure/ai/config/AIConfig.ts](backend/src/infrastructure/ai/config/AIConfig.ts)
- [backend/src/infrastructure/ai/providers/OpenAIProvider.ts](backend/src/infrastructure/ai/providers/OpenAIProvider.ts)
- [backend/src/infrastructure/ai/providers/MockAIProvider.ts](backend/src/infrastructure/ai/providers/MockAIProvider.ts)
- [backend/src/application/services/learning/QuestionAttemptService.ts](backend/src/application/services/learning/QuestionAttemptService.ts)
- [frontend/src/contexts/AuthContext.tsx](frontend/src/contexts/AuthContext.tsx)
- [frontend/src/lib/apiClient.ts](frontend/src/lib/apiClient.ts)
- [backend/tests/integration/phase-7-1-real-ai-production.test.ts](backend/tests/integration/phase-7-1-real-ai-production.test.ts)

---

## 15. Final Conclusion

1. Can a real student currently use Mentora end-to-end?  
   Not proven in a real production deployment. The repository contains the logic and passing tests, but a genuine live deployment is not established by the repo alone.

2. Which exact parts work today?  
   The backend and frontend test suites pass, the code compiles, auth and routing patterns are implemented, and the learning-state and assessment logic are in place.

3. Which exact parts do not work?  
   The real production environment configuration is not present by default; the live production stack is not proven; and AI is intentionally mock-by-default.

4. Is the frontend production-deployable?  
   Yes as a static build, but only with a correctly configured backend path and deployment topology. The repo does not prove a real deployed backend exists.

5. Is the backend production-deployable?  
   Not by default. It requires real secrets, a production database, explicit AI config, and a validated production environment.

6. Is the database production-ready?  
   No. The default schema is SQLite, and production validation explicitly rejects file-based SQLite URLs.

7. Is real AI active?  
   No, not by default. The repository intentionally defaults to mock AI, with real OpenAI support gated behind explicit configuration.

8. What are the minimum remaining blockers before real users can use the product?  
   Real production env setup, a real database, production deployment topology, validated external AI configuration if AI is required, and a final live smoke test against the real stack.

AUDIT COMPLETE — NO APPLICATION CODE MODIFIED
