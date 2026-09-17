# MENTORA — Phase 7.4 Final Audit Report

**Scope:** final frontend + backend verification for the Phase 7.4 deliverable —
the student attempt view carries the display name of a question's authoritative
PRIMARY MicroSkill, resolved server-side, never invented by the client.

**Audit date:** run on the current working tree (`main`, uncommitted Phase 1–7.4
work). All figures below were produced by executing the commands shown; nothing
is estimated.

---

## 1. Verdict

| Area | Result | Evidence |
|------|--------|----------|
| Backend typecheck | **PASS** (0 errors) | `npx tsc --noEmit` → exit 0 |
| Backend build (emit) | **PASS** (0 errors) | `npx tsc` → exit 0 |
| Backend test suite | **PASS — 869 / 869** | `npx vitest run` → 39 files, 131.44s |
| Backend Phase 7.4 tests | **PASS — 6 / 6** | new `phase-7-4-attempt-skill-label.test.ts` |
| Frontend typecheck | **PASS** (0 errors) | `npx tsc --noEmit` → exit 0 |
| Frontend production build | **PASS** | `npx vite build` → 1695 modules, 788ms |
| Frontend test suite | **PASS — 205 / 205** | `npx vitest run` → 21 files, 3.01s |

**Overall: GREEN.** Both applications typecheck, build and pass their full test
suites; the Phase 7.4 behaviour is now covered by a dedicated, real-HTTP test.

> Note: the `npm warn Unknown user config "node-linker"` line is emitted by the
> local npm config and is unrelated to the project — it does not affect any
> result.

---

## 2. Captured numbers

### 2.1 Test suites

| Suite | Files | Tests | Failed | Duration |
|-------|------:|------:|-------:|---------:|
| Backend (`backend/`) | 39 | 869 | 0 | 131.44s |
| Frontend (`frontend/`) | 21 | 205 | 0 | 3.01s |
| **Total** | **60** | **1074** | **0** | — |

The backend run for the **baseline (pre-audit)** suite was 38 files / 863 tests;
adding the dedicated Phase 7.4 suite contributed exactly **+1 file / +6 tests →
39 files / 869 tests**, all passing. No regressions.

### 2.2 Static checks & build

| Check | Command | Result |
|-------|---------|--------|
| Backend typecheck | `backend: npx tsc --noEmit` | exit 0, 0 errors |
| Backend build | `backend: npx tsc` | exit 0, 0 errors |
| Frontend typecheck | `frontend: npx tsc --noEmit` | exit 0, 0 errors |
| Frontend build | `frontend: npx vite build` | exit 0 |

Frontend production bundle (from the build log):

| Asset | Raw | Gzip |
|-------|----:|-----:|
| `index.html` | 1.19 kB | 0.61 kB |
| `assets/index-*.css` | 20.34 kB | 4.67 kB |
| `assets/index-*.js` | 213.26 kB | 63.73 kB |

### 2.3 Codebase size

| Metric | Count |
|--------|------:|
| Backend source files (`backend/src/**/*.ts`) | 165 |
| Backend test files (`backend/tests/**/*.test.ts`) | 39 |
| Frontend source files (`frontend/src/**/*.{ts,tsx}`) | 47 |
| Frontend test files (`frontend/src/**/*.test.{ts,tsx}`) | 21 |

---

## 3. Phase 7.4 deliverable — what was verified

### 3.1 Requirement

A student reading their attempt history (`Yanlışlarım`, `SoruGetir`) must see the
**curriculum term they actually study** for a question — the display name of the
question's authoritative **PRIMARY MicroSkill** — resolved by the backend. When no
authoritative mapping exists the field must be `null`, and the UI must say
"Analiz bekleniyor" rather than invent a topic name. The internal `microSkillId`
must never cross the HTTP boundary.

### 3.2 Implementation (already present, now under test)

- `backend/src/api/controllers/QuestionAttemptController.ts`
  - `toStudentAttemptView()` adds `skillName` to the safe student projection.
  - `resolvePrimarySkillName()` — read-only, best-effort; selects the oldest
    active `isPrimary: true` `QuestionSkillMapping`, then returns the mapped
    `MicroSkill.name` **only if `MicroSkill.isActive`**; otherwise `null`.
- `backend/src/index.ts` — injects `prisma` into the controller (last ctor arg).
- `frontend/src/lib/studentJourney.ts` — `AttemptResult.skillName?: string | null`.
- `frontend/src/components/Yanlislarim.tsx` / `SoruGetir.tsx` — prefer
  `attempt.skillName`; render nothing when absent (no fabricated label).

### 3.3 Verification gap closed

Before this audit, Phase 7.4 (`skillName`) had **no dedicated test** — only the
Phase 7.2 journey asserted mastery, not the read-only label. A new suite was added:

`backend/tests/integration/phase-7-4-attempt-skill-label.test.ts` — drives the
**real HTTP surface** (`POST/GET /api/v1/question-attempts`) end-to-end:

| Test | Asserts |
|------|---------|
| **L1** | An active PRIMARY mapping → `skillName` equals the MicroSkill name; the internal `microSkillId` does **not** appear in the response body. |
| **L2** | The list endpoint labels every attempt with the resolved name. |
| **L3** | No PRIMARY mapping → `skillName` is `null` (never a guessed topic). |
| **L4** | A SECONDARY-only mapping does not masquerade as the PRIMARY label. |
| **L5** | An **inactive** mapped MicroSkill → `null` (no stale curriculum term). |
| **L6** | Cross-student read is `403`; the label never leaks to another student. |

Result: **6 / 6 passed.**

---

## 4. Frontend ↔ backend contract coverage (Phase 6.7 / 7.x)

The end-to-end student journey is exercised over real HTTP by the integration
suites (all green):

- `frontend-journey-contract.test.ts` (3 tests) — ingestion → analyze → review →
  canonical → attempt → mastery/recommendation.
- `phase-7-1-real-ai-production.test.ts` (40 tests) — AI boundary/failure/privacy;
  every external boundary is a fake, no real network call.
- `phase-7-2-question-data-infrastructure.test.ts` (59 tests) — question quality,
  provenance, mapping integrity, synthetic real-data journey.
- `phase-7-3-production-hardening.test.ts` (71 tests) — fail-closed config, CORS,
  auth hardening, IDOR, upload security, AI egress/cost, logging privacy.
- `phase-7-4-attempt-skill-label.test.ts` (6 tests) — **new**, the curriculum
  label contract above.

The frontend consumes only the safe projections; the backend remains the sole
authority for correctness, mastery and error analysis.

---

## 5. Reproduce this audit

```bash
# Backend
cd backend
npx tsc --noEmit            # typecheck → exit 0
npx tsc                     # build     → exit 0
npx vitest run              # 39 files / 869 tests, all pass

# Frontend
cd ../frontend
npx tsc --noEmit            # typecheck → exit 0
npx vite build              # production build → exit 0
npx vitest run              # 21 files / 205 tests, all pass
```

---

## 6. Residual notes (non-blocking)

- **Frontend `act(...)` warnings** are emitted by React Testing Library during
  `SoruGetir.test.tsx` (async state updates). They are warnings only — all 19
  tests in that file pass and the suite exits 0. Tracked as cosmetic, not a gap.
- **Coverage report** was not run in this pass (`test:coverage` uses
  `@vitest/coverage-v8`). Pass/fail counts are complete; line/branch coverage can
  be produced separately if required for release gating.
- The frontend `build` script (`tsc --noEmit && vite build`) already chains the
  typecheck + build verified here.

---

## 7. Conclusion

Phase 7.4 is **complete and verified** on both sides of the stack:

- **Frontend** — typechecks, builds (213.26 kB JS / 63.73 kB gzip), 205/205 tests.
- **Backend** — typechecks, builds, 869/869 tests (incl. 6 new Phase 7.4 tests).
- The student-facing curriculum label is authoritative, privacy-preserving
  (`microSkillId` never exposed), student-isolated, and honest when the mapping is
  missing (`null`).

**Total: 60 test files / 1074 tests / 0 failures.**
