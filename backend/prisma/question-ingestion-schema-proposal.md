# Question Ingestion — Schema Proposal

> **DESIGN ONLY.** No migration is written, no schema file is modified, no seed is run.
> This document specifies what a future migration *would* contain, and why.
> Companion document: `question-ingestion-design.md`.

---

## DECISION

```text
SCHEMA_CHANGE_REQUIRED: YES
```

**Why.** The existing `Question` spine (`Question`, `QuestionOption`, `QuestionAttempt`,
`QuestionSkillMapping`) is well-formed and is **kept unchanged**. However, four capabilities
required by the product scenario have **no place to live** in the current schema:

1. **Provenance** — there is no `source`, `sourceType`, license, or uploader field on
   `Question`. Verified: `Question.metadata` is NULL on all 159 rows; there is no other home.
2. **Raw ingestion** — no model can hold the uploaded image reference, OCR text, or
   extraction confidence. The three trust levels of §3 (design doc) collapse into one.
3. **Upload instances** — `QuestionAttempt.questionId` FKs straight to `Question`, so two
   uploads of the same question are indistinguishable from two different questions.
4. **Curriculum anchoring** — `Question.learningObjectiveId` is a bare `String?` with **no
   FK** to `LearningOutcome`, and is NULL on all 159 rows. There is no way to record a
   *candidate* anchor with confidence and a decision.

The change is **purely additive**: new models, and new **nullable** columns on `Question`.
No existing column is dropped, retyped, or made non-nullable. No existing row is rewritten.

```text
EXISTING MODELS PRESERVED UNCHANGED:
  Question, QuestionOption, QuestionAttempt, ErrorAnalysis,
  QuestionSkillMapping, MicroSkill, ProcessComponent,
  LearningOutcome, Theme, CurriculumVersion
```

---

## 1. ENUMS

The current schema uses `String` for `type`, `severity`, `category`, etc. That is a deliberate
existing convention. **This proposal keeps `String` for consistency** and specifies the
allowed vocabularies in comments and invariants, rather than introducing enums that would
require touching existing models. (Introducing enums is a separate, optional hardening step
and is explicitly out of scope here.)

Allowed vocabularies, defined as constants in application code:

```text
QuestionOrigin :
    MEB | MENTORA_MANUAL | LICENSED_BANK | TEACHER_CREATED | STUDENT_UPLOADED

QuestionTrust :
    UNVERIFIED | EXTRACTED | NORMALIZED | AI_ANALYZED | HUMAN_APPROVED | REJECTED

IngestionState :
    INGESTED | EXTRACTED | EXTRACTION_FAILED | NORMALIZED | ANALYZED | MAPPED
    | REVIEW_REQUIRED | APPROVED | REJECTED

CandidateLevel :
    LEARNING_OUTCOME | PROCESS_COMPONENT

CandidateDecision :
    PENDING | PRIMARY | SECONDARY | REJECTED

DerivationMethod :
    OCR | AI_NORMALIZED | AI_ANCHORED | AI_MAPPED | MANUAL
```

---

## 2. NEW MODEL — `QuestionSource`

**Purpose.** Provenance, kept as its own model so that one origin can be shared by many
questions and so that license/contract metadata is not duplicated per row.

```prisma
model QuestionSource {
  id              String   @id @default(cuid())
  code            String   @unique          // stable, human-readable, e.g. "MEB-11-MATH"
  name            String
  origin          String                     // QuestionOrigin vocabulary
  trustCeiling    String                     // QuestionTrust: max trust this source may reach
  license         String?                    // e.g. "CC-BY-4.0", "Mentora-Proprietary"
  sourceDocument  String?                    // book / file / URL descriptor
  externalRef     String?                    // publisher or catalogue reference
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  questions       Question[]
  ingestions      QuestionIngestion[]

  @@index([origin])
  @@index([isActive])
}
```

**Notes**

- `trustCeiling` encodes §11.2 of the design doc: a `STUDENT_UPLOADED` source has a ceiling
  below `HUMAN_APPROVED`, so no question from it can be auto-promoted into the bank.
- This mirrors the existing precedent where `MicroSkill.source = 'MEB-11-MATH-CURRICULUM'`
  and `ErrorPattern.source = 'MENTORA_MANUAL'` are stable string codes.

---

## 3. NEW MODEL — `QuestionIngestion` (the raw layer)

**Purpose.** Holds everything produced *before* a canonical question exists: the image, the
OCR output, and the state machine. This is the model that makes §3 of the design doc
(raw vs canonical) real.

```prisma
model QuestionIngestion {
  id                       String   @id @default(cuid())

  // --- provenance ---
  sourceId                 String?
  ingestedByUserId         String?              // student who uploaded; null for system import
  ingestMethod             String               // IMAGE_UPLOAD | TEXT_PASTE | PDF | BANK_IMPORT

  // --- raw artifacts (STAGE 1-3) ---
  originalAssetRef         String?              // storage key / URI of the uploaded image
  originalAssetMimeType    String?
  originalAssetSizeBytes   Int?
  rawExtractedText         String?              // verbatim OCR/paste output, never edited

  // --- extraction quality (STAGE 3) ---
  ocrConfidence            Float?               // 0..1 ; null when no OCR was involved
  extractionFailed         Boolean  @default(false)
  extractionErrorMessage   String?

  // --- normalization (STAGE 4) ---
  normalizedText           String?
  normalizedExpression     String?              // LaTeX / math form, optional
  parsingConfidence        Float?               // 0..1 ; "is this a well-formed question?"

  // --- workflow ---
  state                    String   @default("INGESTED")   // IngestionState vocabulary
  requiresReview           Boolean  @default(true)
  reviewNotes              String?

  // --- linkage ---
  resultingQuestionId      String?  @unique      // set once promoted to canonical

  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  source                   QuestionSource? @relation(fields: [sourceId], references: [id])
  resultingQuestion        Question?       @relation("QuestionIngestionResult",
                                                    fields: [resultingQuestionId],
                                                    references: [id])
  instances                QuestionInstance[]

  @@index([state])
  @@index([ingestedByUserId])
  @@index([sourceId])
  @@index([requiresReview])
  @@index([createdAt])
}
```

**Invariants**

| # | Invariant |
|---|---|
| I1 | `rawExtractedText` is **immutable** once written. Correction happens in `normalizedText`, never by overwriting the raw value. |
| I2 | `state = 'EXTRACTION_FAILED'` implies `extractionFailed = true`. |
| I3 | `state = 'NORMALIZED'` or later implies `normalizedText IS NOT NULL`. |
| I4 | `resultingQuestionId` may be set only when `state IN ('APPROVED')`. |
| I5 | `ocrConfidence` is non-null iff `ingestMethod = 'IMAGE_UPLOAD'`. |

**Why a separate model rather than fields on `Question`:** an ingestion can fail, be retried,
or produce a duplicate of an existing canonical question. If it lived on `Question`, every
failed OCR attempt would create a junk `Question` row. Keeping it separate means the raw
layer can contain many records that never become questions — which is the correct model of
reality.

---

## 4. NEW MODEL — `QuestionInstance`

**Purpose.** One student's upload of a (possibly already-canonical) question. This is §10 of
the design doc: separating the canonical question from the individual submission.

```prisma
model QuestionInstance {
  id             String   @id @default(cuid())
  questionId     String
  ingestionId    String?
  studentId      String?                  // null for admin/teacher-created instances

  assetRef       String?                  // this student's own image
  assetMimeType  String?
  assetHash      String?                  // content hash, enables "same file uploaded twice"

  uploadedAt     DateTime @default(now())
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  question       Question            @relation(fields: [questionId], references: [id], onDelete: Cascade)
  ingestion      QuestionIngestion?  @relation(fields: [ingestionId], references: [id])
  student        StudentProfile?     @relation(fields: [studentId], references: [id], onDelete: Cascade)
  attempts       QuestionAttempt[]

  @@index([questionId])
  @@index([studentId])
  @@index([ingestionId])
  @@index([assetHash])
  @@index([uploadedAt])
}
```

**Invariants**

| # | Invariant |
|---|---|
| I6 | One canonical `Question` may have many `QuestionInstance` rows (Student A twice, Student B once). |
| I7 | `assetRef` belongs to the instance, never to `Question` — deleting a student's upload must not affect the canonical question. |
| I8 | `assetHash` is **not unique**. It exists to *detect* re-uploads, not to forbid them. See §10.5 of the design doc: automated photo dedup is deliberately out of MVP scope. |

**Relation to the existing chain.** `QuestionAttempt` keeps its `questionId` FK unchanged.
`QuestionInstance` is additive: an attempt *may* reference an instance (student upload) or
have none (bank question).

---

## 5. NEW MODEL — `CurriculumCandidate`

**Purpose.** The anchoring layer from §6 of the design doc. Records *which curriculum area a
question plausibly belongs to*, with confidence and an explicit decision — deliberately
**without** a MicroSkill level, so that alignment stays distinct from skill mapping.

```prisma
model CurriculumCandidate {
  id             String   @id @default(cuid())
  questionId     String

  level          String                  // CandidateLevel: LEARNING_OUTCOME | PROCESS_COMPONENT
  targetId       String                  // id of LearningOutcome or ProcessComponent

  confidence     Float                   // inference certainty, 0..1  (NOT relevance)
  decision       String   @default("PENDING")  // CandidateDecision
  method         String                  // DerivationMethod: AI_ANCHORED | MANUAL
  rationale      String?                 // why this candidate was proposed

  reviewed       Boolean  @default(false)
  reviewedByUserId String?

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  question       Question @relation(fields: [questionId], references: [id], onDelete: Cascade)

  @@unique([questionId, level, targetId])
  @@index([questionId])
  @@index([level, targetId])
  @@index([decision])
  @@index([confidence])
  @@index([reviewed])
}
```

### 5.1 The polymorphic-target problem — stated honestly

`targetId` points at `LearningOutcome` **or** `ProcessComponent` depending on `level`. Prisma
cannot express a conditional FK, so this is a **soft reference**, exactly like the existing
`Question.learningObjectiveId` and `QuestionAttempt.assessmentAttemptId`. Two mitigations:

1. `@@unique([questionId, level, targetId])` prevents duplicate candidates.
2. Referential integrity is enforced by an application-level check plus a database integrity
   test (the repo already has `tests/integration/database-integrity.test.ts` for this style
   of check).

**Alternative considered and rejected:** two nullable FK columns
(`learningOutcomeId?` + `processComponentId?`) with a CHECK that exactly one is non-null.
Cleaner integrity, but it doubles the columns, makes "set of candidates for a question"
awkward, and diverges from the codebase's existing soft-reference style. If DB-level
integrity is later judged essential, this is the migration path — but it is not worth the
complexity for MVP.

### 5.2 Multiple candidates

**Permitted and expected.** A question may hold several candidates across both levels.
Invariants:

| # | Invariant |
|---|---|
| I9 | At most **one** candidate per question may have `decision = 'PRIMARY'`. |
| I10 | `decision = 'REJECTED'` rows are **retained**, never deleted — they are evidence of what was considered. |
| I11 | A `PROCESS_COMPONENT` candidate must belong to the same `LearningOutcome` as that question's primary `LEARNING_OUTCOME` candidate (consistency rule, application-enforced). |
| I12 | `confidence` here is inference certainty. It is **never** copied from, or into, `QuestionSkillMapping.relevance` or `aiConfidence`. |

---

## 6. CHANGES TO `Question` (additive, nullable only)

```prisma
model Question {
  // ... all existing fields unchanged ...

  // --- ADDED: provenance (nullable) ---
  sourceId          String?
  origin            String?     // QuestionOrigin vocabulary
  trust             String      @default("UNVERIFIED")   // QuestionTrust vocabulary
  sourceReference   String?     // external id / book+page
  isFixture         Boolean     @default(false)          // labels the 159 dev placeholders (§12)

  // --- ADDED: linkage (nullable) ---
  canonicalKey      String?     @unique                  // dedup key for BANK questions only

  // ... existing relations unchanged ...

  // --- ADDED: relations ---
  source            QuestionSource?      @relation(fields: [sourceId], references: [id])
  curriculumCandidates CurriculumCandidate[]
  instances         QuestionInstance[]
  ingestions        QuestionIngestion[]  @relation("QuestionIngestionResult")
}
```

### 6.1 Field rationale

| Field | Type | Why nullable | Why needed |
|---|---|
| `sourceId` | `String?` | 159 existing rows have no source | Adds the provenance axis without breaking existing rows |
| `origin` | `String?` | ditto | Denormalized fast filter; mirrors `MicroSkill.source` precedent |
| `trust` | `String` + default | has a safe default | Defaults to `UNVERIFIED`, so all 159 existing rows become explicitly untrusted rather than ambiguously trusted |
| `sourceReference` | `String?` | external data may be unknown | Cheapest provenance win |
| `isFixture` | `Boolean` default false | backward compatible | Labelling strategy from §12 of the design doc |
| `canonicalKey` | `String?` unique | only bank questions have one | Dedup for the bank; `NULL` is allowed many times in SQLite/Postgres unique indexes |

### 6.2 What is deliberately NOT changed

- `content`, `correctAnswer`, `type`, `difficulty`, `explanation`, `isActive` — untouched.
- `skillId` — left as the legacy free-text field. It is **not** upgraded to a relation,
  because `QuestionSkillMapping` is the correct and already-designed bridge. Repurposing
  `skillId` would create two competing truths.
- `learningObjectiveId` — left as-is for backward compatibility. New anchoring uses
  `CurriculumCandidate`. (A later cleanup could deprecate it; not in MVP.)
- `metadata` — left as-is; **not** used as the home for new typed fields (§13.2 of design doc).

### 6.3 The `type` vocabulary defect

`Question.type` is a free `String`. Two divergent vocabularies exist today:

- DB/Prisma: `'MULTIPLE_CHOICE'`, `'CALCULATION'`
- Domain entity (`src/domain/entities/Question.ts:7`): `'multiple_choice'`, `'open_ended'`,
  `'calculation'`, `'conceptual'`

**No migration changes the column**, but the implementation phase MUST pick one vocabulary
and add a mapping/validation at the boundary. Recommendation: adopt the UPPER_SNAKE DB
values as canonical and update the domain entity to match.

---

## 7. CHANGES TO `QuestionAttempt` (additive, nullable only)

```prisma
model QuestionAttempt {
  // ... all existing fields unchanged ...

  instanceId  String?   // ADDED: links an attempt to the upload it came from (null for bank)

  instance    QuestionInstance? @relation(fields: [instanceId], references: [id])

  @@index([instanceId])   // ADDED
}
```

**Why nullable:** all existing attempts (2 rows today, plus every test fixture) have no
instance and must keep working unchanged.

---

## 8. UNCHANGED MODELS

The following are explicitly **not modified**:

| Model | Status |
|---|---|
| `QuestionOption` | unchanged |
| `QuestionSkillMapping` | unchanged — already has `relevance`, `isPrimary`, `aiConfidence`, `mappingSource`, `reviewed`, `@@unique([questionId, microSkillId])` |
| `ErrorAnalysis` | unchanged |
| `MicroSkill` | unchanged |
| `ProcessComponent` | unchanged |
| `LearningOutcome` | unchanged |
| `Theme` | unchanged |
| `CurriculumVersion` | unchanged |
| `StudentProfile` | relation added **from** `QuestionInstance` only; no column change |

---

## 9. UNIQUE CONSTRAINTS (summary)

| Model | Constraint | Purpose |
|---|---|---|
| `QuestionSource` | `@@unique([code])` | stable source identity |
| `Question` | `@@unique([canonicalKey])` | bank dedup; many NULLs allowed |
| `QuestionIngestion` | `@@unique([resultingQuestionId])` | one ingestion yields at most one canonical question |
| `CurriculumCandidate` | `@@unique([questionId, level, targetId])` | no duplicate candidates |
| `QuestionSkillMapping` | `@@unique([questionId, microSkillId])` | **already exists**; guarantees deterministic mapping |
| `QuestionInstance` | *none* on `assetHash` | by design — re-uploads must be allowed (§10.5) |

---

## 10. INDEXES (summary)

| Model | Index | Query it serves |
|---|---|---|
| `QuestionSource` | `origin`, `isActive` | filter sources by kind |
| `QuestionIngestion` | `state`, `ingestedByUserId`, `requiresReview`, `createdAt` | review queue, per-student history |
| `QuestionInstance` | `questionId`, `studentId`, `assetHash`, `uploadedAt` | "all uploads of Q", "student's uploads", re-upload detection |
| `CurriculumCandidate` | `questionId`, `(level, targetId)`, `decision`, `confidence` | candidates for a question, reverse lookup by LO/PC, review queue |
| `Question` | `sourceId`, `trust`, `isFixture` (added) | bank vs upload filtering, fixture exclusion |
| `QuestionAttempt` | `instanceId` (added) | attempts for an upload |

---

## 11. INVARIANTS (consolidated)

```text
INGESTION
I1   rawExtractedText is immutable after write
I2   state = EXTRACTION_FAILED  =>  extractionFailed = true
I3   state >= NORMALIZED        =>  normalizedText IS NOT NULL
I4   resultingQuestionId set    =>  state = APPROVED
I5   ocrConfidence non-null     <=> ingestMethod = IMAGE_UPLOAD

INSTANCES
I6   Question : QuestionInstance = 1 : N
I7   assetRef lives on the instance, never on Question
I8   assetHash is NOT unique (duplicates are allowed by design)

CURRICULUM ANCHORING
I9   at most one CurriculumCandidate per question has decision = PRIMARY
I10  REJECTED candidates are retained, never deleted
I11  PROCESS_COMPONENT candidate must sit under the primary LEARNING_OUTCOME
I12  candidate.confidence is never copied to/from mapping relevance or aiConfidence

SKILL MAPPING (unchanged, carried forward)
I13  at most one PRIMARY QuestionSkillMapping per question   <-- set-level, app-enforced
I14  relevance IS NOT aiConfidence (distinct columns, distinct meanings)
I15  aiConfidence below threshold  =>  reviewed = false
I16  no MicroSkill may be created by the mapping process
I17  no mapping to ProcessComponent / LearningOutcome in QuestionSkillMapping

TRUST / PROVENANCE
I18  Question.trust may not exceed its QuestionSource.trustCeiling
I19  STUDENT_UPLOADED questions are never auto-added to the bank
I20  Question : QuestionSkillMapping / CurriculumCandidate requires trust >= a threshold
     before it may be used for session or assessment selection
```

**I13 is the important one to flag.** The database enforces `@@unique([questionId,
microSkillId])` but **cannot** enforce "at most one `isPrimary = true` per question". This
was already identified in the previous phase. It MUST be enforced by the writer and asserted
by an integrity test. It is not a schema deficiency — it belongs in application logic.

---

## 12. MIGRATION REQUIREMENTS

### 12.1 Shape

```text
MIGRATION TYPE : ADDITIVE ONLY
```

| Change | Kind |
|---|---|
| `QuestionSource` | new table |
| `QuestionIngestion` | new table |
| `QuestionInstance` | new table |
| `CurriculumCandidate` | new table |
| `Question.sourceId`, `.origin`, `.sourceReference`, `.canonicalKey`, `.isFixture` | new **nullable** columns |
| `Question.trust` | new column **with default** `'UNVERIFIED'` |
| `QuestionAttempt.instanceId` | new **nullable** column |
| new indexes | additive |

### 12.2 What the migration must NOT do

```text
- DROP any column
- ALTER any existing column type
- make any existing nullable column NOT NULL
- rewrite or delete any existing row
- touch the 159 existing Question rows beyond the automatic default of Question.trust
```

### 12.3 Expected effect on existing data

| Table | Rows before | Rows after |
|---|---|---|
| Question | 159 | 159 (unchanged; `trust` defaults to `UNVERIFIED`, `isFixture` defaults to `false`) |
| QuestionOption | 8 | 8 |
| QuestionAttempt | 2 | 2 |
| QuestionSkillMapping | 0 | 0 |
| MicroSkill | 70 | 70 |
| ProcessComponent | 60 | 60 |
| ErrorPattern | 26 | 26 |
| ErrorPatternMicroSkill | 76 | 76 |

### 12.4 Test impact

- The 86 existing tests MUST continue to pass **without modification**.
- Risk to watch: `tests/setup.ts` `beforeEach` deletes tables in FK order. New tables must be
  added to that list in the correct position, or FK violations will occur. `QuestionSource`,
  `QuestionInstance`, `CurriculumCandidate`, `QuestionIngestion` must be deleted **before**
  `Question`, and `QuestionSource` before the models that reference it.
- This is an **implementation-phase** concern, recorded here so it is not missed.

### 12.5 SQLite note

The project uses `provider = "sqlite"`. Adding nullable columns and new tables is
straightforward. Two caveats:

- SQLite unique indexes allow multiple `NULL`s, so `@@unique([canonicalKey])` with many
  `NULL` values behaves as intended.
- Adding a column with a `DEFAULT` to an existing table is supported.

---

## 13. WHY NOT ALTERNATIVES (recap)

| Alternative | Rejected because |
|---|---|
| Put raw text + image directly on `Question` | Collapses three trust levels; every failed OCR creates a junk Question; breaks canonical dedup |
| Only add a `sourceType` string (design doc option B) | Records origin but not state, raw text, image, or instances — the pipeline stays unrepresentable |
| Store new fields in `Question.metadata` | unvalidated, unindexed, un-FK'd, NULL on all 159 rows — integrity unenforceable |
| Two nullable FK columns on `CurriculumCandidate` instead of `targetId` | Doubles columns, awkward set semantics, diverges from existing soft-reference style. Kept as the escape hatch if DB-level integrity is later required |
| Add a `MicroSkill` level to `CurriculumCandidate` | Re-merges alignment with skill mapping, defeating the separation that §5.1 of the design doc exists to protect |
| Model dedup as `@@unique([assetHash])` | Would silently block a student re-uploading their own photo; wrong-merge risk exceeds duplication risk (§10.5) |
| Introduce Prisma enums everywhere | Touches existing models, diverges from the codebase's `String` convention, and is orthogonal to the requirement. Deferred |

---

## 14. SUMMARY

```text
SCHEMA_CHANGE_REQUIRED: YES

NEW MODELS      : 4   (QuestionSource, QuestionIngestion, QuestionInstance,
                       CurriculumCandidate)
NEW COLUMNS     : 8   (7 on Question, 1 on QuestionAttempt)  — all nullable / defaulted
CHANGED MODELS  : 2   (Question, QuestionAttempt)            — additive only
UNCHANGED       : 10  (QuestionOption, QuestionSkillMapping, ErrorAnalysis, MicroSkill,
                       ProcessComponent, LearningOutcome, Theme, CurriculumVersion,
                       StudentProfile, ...)
MIGRATION TYPE  : additive only
BREAKING        : none
EXISTING TESTS  : 86/86 must remain green, unmodified
```

Nothing in this document has been applied. No migration file, no schema edit, no seed.
