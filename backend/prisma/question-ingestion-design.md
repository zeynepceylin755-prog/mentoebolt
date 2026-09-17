# Question Ingestion & Curriculum Anchoring — Design Review

> **Status of this document**: DESIGN / AUDIT ONLY.
> No code, no migration, no seed, no schema change was produced.
> All findings below are grounded in the actual repository state, verified against
> `backend/prisma/schema.prisma`, `backend/src/**`, `backend/tests/**` and the live
> `backend/prisma/dev.db`.

---

## 0. CURRENT STATE (verified)

Four counts required by the brief, read directly from `backend/prisma/dev.db`:

| Entity | Count |
|---|---|
| **Question** | **159** |
| **MicroSkill** | **70** |
| **ProcessComponent** | **60** |
| **QuestionSkillMapping** | **0** |

Supporting figures:

| Entity | Count |
|---|---|
| CurriculumVersion | 1 |
| Theme | 3 |
| LearningOutcome | 9 |
| QuestionOption | 8 |
| QuestionAttempt | 2 |
| ErrorAnalysis | 0 |
| ErrorPattern | 26 |
| ErrorPatternMicroSkill | 76 |
| **Question distinct `content` values** | **18** |
| Tests passing | 86/86 |

```text
CLOSED CONSTRAINT: 159 questions, 18 distinct contents.
The corpus is duplicated fixture data, not a question bank.
```

---

## 1. CURRENT ARCHITECTURE

### 1.1 The models, as they actually exist

| Model | Location | Purpose today |
|---|---|---|
| `Question` | `schema.prisma:109` | The canonical question row |
| `QuestionOption` | `schema.prisma:136` | MC choices, `@@unique([questionId, order])` |
| `QuestionAttempt` | `schema.prisma:149` | A student's answer to a question |
| `ErrorAnalysis` | `schema.prisma:185` | Post-hoc error diagnosis on an attempt |
| `QuestionSkillMapping` | `schema.prisma:679` | Question -> MicroSkill bridge (**empty**) |
| `MicroSkill` | `schema.prisma:609` | 70 grade-11 curriculum skills |
| `ProcessComponent` | `schema.prisma:586` | 60 components |
| `LearningOutcome` | `schema.prisma:567` | 9 outcomes |
| `Theme` | `schema.prisma:546` | 3 themes |
| `CurriculumVersion` | `schema.prisma:526` | 1 MEB version |

### 1.2 `Question` field-by-field findings

Each question in the brief is answered with the real field name.

| Brief question | Finding |
|---|---|
| **How are questions created today?** | **There is no production creation path.** `prisma.question.create` appears **only** in `backend/prisma/seed.ts` (2 calls) and integration tests. No service, controller, route, or repository creates a `Question`. |
| **What fields does it carry?** | `id, content, type, difficulty, skillId, learningObjectiveId?, correctAnswer, explanation?, isActive, exposureCount, metadata?, createdAt, updatedAt` |
| **Is the source tracked?** | **No.** There is no `source`, `sourceType`, `sourceReference`, `uploadedBy`, or `license` field. Provenance is absent from the model. |
| **Is there image support?** | **No.** There is no image/attachment field and no `QuestionAsset` model. |
| **Is OCR output stored?** | **No.** No OCR/raw-text field exists anywhere. |
| **Is a solution/explanation stored?** | **Yes** — `Question.explanation` (`String?`), but populated on only **2** of 159 rows. |
| **Is the correct answer stored?** | **Yes** — `Question.correctAnswer` (`String`, required). |
| **Is question type stored?** | **Yes** — `Question.type` (`String`, default `"MULTIPLE_CHOICE"`). Live values: `MULTIPLE_CHOICE`=158, `CALCULATION`=1. Note this is a free `String`, not an enum, and it is **inconsistent in casing** with the domain entity (see §1.4). |
| **How are options stored?** | As rows in `QuestionOption` (`text`, `isCorrect`, `order`), `@@unique([questionId, order])`. Only 8 option rows exist (2 questions x 4). The 157 arithmetic rows have options and `correctAnswer` but **zero** `QuestionOption` children. |
| **How is difficulty stored?** | `Question.difficulty` (`Int`, default 1). Live: 158 rows = 1, 1 row = 2. Effectively constant. |
| **How is the curriculum relation stored?** | **It is not.** `Question.learningObjectiveId` is a bare `String?` with an `@@index` but **no Prisma relation** to `LearningOutcome`, and it is **NULL on all 159 rows**. `Question.skillId` is a required free-text `String` with no relation to `MicroSkill`. Live values are synthetic: `skill1..skill11`, `skill-1`, `skill-complete`. |
| **Which API endpoints touch Question?** | `POST /api/v1/assessments/:assessmentId/questions` (`assessmentRoutes.ts:56`) — body `{ questionIds: string[] }`, ADMIN/CONTENT_MANAGER only. It **attaches existing** questions to an assessment via `AssessmentService.addQuestionsToAssessment`. There is **no** create/read/update Question endpoint. |
| **Where are test fixtures created?** | `beforeEach` in `tests/setup.ts` wipes all tables, then each test file creates its own `Question` rows inline: `tests/integration/assessment-transactions.test.ts`, `idempotency-integration.test.ts`, `session-concurrency.test.ts`, `database-integrity.test.ts`. Plus `prisma/seed.ts`. |

### 1.3 The decisive finding: Question is a dead-end entity

```text
Question
  ├── read by:  AssessmentService.addQuestionsToAssessment  (attach only)
  │             LearningSessionService (session question selection)
  │             QuestionSelector (random pick)
  ├── written by: NOTHING in production
  └── sources:  seed.ts + test fixtures only
```

`IQuestionRepository` (`src/domain/interfaces/IQuestionRepository.ts`) declares
`save / findById / findBySkillId / findRandomBySkillId / findAll / delete` — but:

- there is **no implementing class** anywhere in the repository,
- it is **never imported** outside its own file,
- there is **no `QuestionController`** and **no `createQuestionRoutes`**.

So the "question lifecycle" is currently a declaration with no implementation.

### 1.4 Two divergent Question shapes (a real defect to note)

`Question` exists twice, with **incompatible `type` vocabularies**:

| Source | `type` values |
|---|---|
| Prisma / DB | `'MULTIPLE_CHOICE'`, `'CALCULATION'` (UPPER_SNAKE) |
| Domain entity `src/domain/entities/Question.ts:7` | `'multiple_choice' \| 'open_ended' \| 'calculation' \| 'conceptual'` (lower_snake) |

They are joined by nothing — no mapper exists, because nothing ever converts one to the
other. Any ingestion design must pick **one** canonical vocabulary.

### 1.5 The 159 rows in detail

| Class | Count | Content example |
|---|---|---|
| `PLACEHOLDER_ARITHMETIC` | 130 | `"What is 2 + 2?"` -> `4` |
| `PLACEHOLDER_GENERIC` | 27 | `"Question 1"`, `"Test question"` |
| Real math, off-curriculum | 2 | `"f(x) = 2x + 3 ..."` (functions, grade-10 topic) |

All 159 have `learningObjectiveId = NULL` and `metadata = NULL`.
Only 8 `QuestionOption` rows exist in total.

---

## 2. CURRENT QUESTION MODEL ASSESSMENT

The model is **structurally sound but semantically empty**.

**What it already does well**

- `content` / `correctAnswer` / `type` / `difficulty` / `QuestionOption` cover a simple
  bank question.
- `QuestionSkillMapping` is already the correct, relation-enforced bridge to `MicroSkill`,
  with `@@unique([questionId, microSkillId])`.
- `QuestionAttempt.questionId` is a proper FK, so the attempt chain already anchors to a
  `Question` row.

**What it structurally cannot express**

| Gap | Consequence |
|---|---|
| No provenance (`source`, `sourceType`, license, uploader) | Cannot distinguish MEB / licensed / teacher / student-uploaded / AI-derived. This is the core requirement of §4 and §11. |
| No raw-vs-normalized separation | The pipeline `image -> OCR -> raw text -> normalized -> canonical` has nowhere to live. |
| No image/asset storage | Student photo upload is unrepresentable. |
| No import/submission entity | Cannot tell "Student A uploaded this twice" from "two distinct questions". |
| No review/workflow state | Cannot express `EXTRACTED` vs `APPROVED`; today only `isActive: Boolean`. |
| No curriculum anchor | `learningObjectiveId` is a detached string, NULL everywhere, with no FK. |
| `type` is free `String`, doubly defined | No vocabulary enforcement; two conflicting sets already exist. |
| No deduplication key | 159 rows / 18 contents with no mechanism to prevent re-import duplication. |

---

## 3. RAW INPUT vs CANONICAL QUESTION

### 3.1 The pipeline stages and what each produces

```text
[1] image / text / pdf           (student action)
        |
[2] OCR / extraction             (OCR engine)
        |
[3] raw extracted text           (verbatim, possibly broken)
        |
[4] normalization                (AI + rules)
        |
[5] canonical mathematical question  (validated)
```

### 3.2 Field-by-field decision

Legend — **Requisite**: R = required, O = optional, X = do not store.
**Producer**: S = student, O = OCR, A = AI, H = human.
**Trust**: the reliability ceiling of the value.

| Field | Requisite | Why | Stage | Producer | Trust |
|---|---|
| `originalImageRef` | **R** (when image-sourced) | Legal defensibility and re-OCR; the only ground truth if normalization is questioned later. | 1 | S | High (it is the raw fact) |
| `rawExtractedText` | **R** | The audit trail for OCR quality. Without it, an OCR bug is indistinguishable from a student error. | 3 | O | **Low** |
| `ocrConfidence` | **R** | Routes low-quality extractions to human review instead of into the mapping engine. | 3 | O | n/a (it is a measurement) |
| `normalizedText` | **R** | The canonical human-readable stem, safe to display. | 4 | A (+H) | Medium |
| `mathematicalExpression` | **O** | Only once a math representation (LaTeX/AST) exists. Must **not** block MVP. | 4 | A | Medium |
| `questionStem` | **R** | What the student is asked; the anchor for curriculum analysis. | 5 | A/H | Medium-High |
| `options[]` | **O** | Required for MC, absent for open-ended. | 5 | A/H | Medium |
| `correctAnswer` | **O**, but **R to be "approved"** | A student-uploaded question may legitimately have **no** known answer. Forcing it would fabricate truth. | 5 | H (or source) | High only if human/source |
| `explanation` | **O** | Nice-to-have; `Question.explanation` already exists. | 5 | H/A | Low-Medium |
| `source` / `sourceType` | **R** | Needed to separate bank vs student upload (see §4). | 1 | S/system | High |
| `sourceReference` | **O** | External id / URL / book+page when known. | 1 | S/system | Medium |
| `uploadedBy` | **R** for student uploads | Ownership and access control. | 1 | S | High |
| `extractionConfidence` | **R** | Routing signal for review. | 3-4 | A | n/a |
| `parsingConfidence` | **R** | "Is this even a well-formed question?" — distinct from OCR confidence. | 4 | A | n/a |
| `reviewStatus` | **R** | The gate between "ingested" and "trusted" (§9). | 5+ | system/H | High |

**Not stored**: the intermediate OCR token bounding boxes, the AI prompt/response
transcript. They are high-volume, low-value, and reconstructible. If auditability of an AI
decision is needed, store a *decision record* (model, version, confidence, timestamp), not
the full transcript.

### 3.3 The central distinction

```text
rawExtractedText      = what the machine read            (possibly wrong)
normalizedText        = what we believe the question says (better, still derived)
canonical Question    = what the system will teach against (validated, trusted)
```

These are three different trust levels. Collapsing them into one `content` column (as
today) is exactly what makes the current model unable to support student uploads.

---

## 4. PROVENANCE DESIGN

### 4.1 The sources to distinguish

| Source | Trust | Auto-addable to bank? |
|---|---|---|
| `MEB` | Highest | Yes (it is the authority) |
| `MENTORA_MANUAL` | High | Yes |
| `LICENSED_BANK` | High (contractual) | Yes, with license metadata |
| `TEACHER_CREATED` | High | Only after review |
| `STUDENT_UPLOADED` | **Low** | **Never automatically** |
| `OCR` (derivation, not a source) | Low | n/a — a *method*, not an origin |
| `AI_GENERATED` | Low | Never without review |
| `AI_NORMALIZED` (derivation) | Medium | n/a — a *method* |
| `HUMAN_REVIEWED` (state) | High | n/a — a *state* |

### 4.2 The key insight: origin, method and state are three different axes

Conflating them into one `source` field is the trap. The existing codebase already shows
this working when kept separate:

- `MicroSkill.source = 'MEB-11-MATH-CURRICULUM'` (an **origin**, 70/70 rows)
- `ErrorPattern.source = 'MENTORA_MANUAL'` (an **origin**, 26/26 rows)

Recommendation — model three orthogonal axes:

```text
origin      : WHERE the question came from      (MEB, MENTORA_MANUAL, LICENSED_BANK,
                                                  TEACHER_CREATED, STUDENT_UPLOADED)
derivation  : WHICH automated steps touched it  (OCR, AI_NORMALIZED, AI_MAPPED)
trust       : HOW FAR it has been verified      (UNVERIFIED .. HUMAN_APPROVED)
```

The brief's requirement —

> *"AI tarafından OCR edilmiş / normalize edilmiş bir soru ile insan tarafından
> doğrulanmış soru aynı güven seviyesinde olmamalı."*

— is satisfied by the **`trust` axis**, not by `origin`. A student-uploaded question that a
teacher later verified is *origin = STUDENT_UPLOADED*, *trust = HUMAN_APPROVED*. Those are
not contradictory; they are two facts.

### 4.3 Corollary rules

1. `STUDENT_UPLOADED` questions are **never** auto-promoted into the Mentora Question Bank.
2. Any row whose `trust` is below a threshold must be **excluded from assessment/session
   selection** — a `isActive` flag is too coarse for this.
3. Every AI/OCR-derived field carries its own confidence, so a single low-confidence step
   is visible without discarding the whole record.

---

## 5. CURRICULUM ANCHORING

### 5.1 Three distinct questions that are currently at risk of being merged

| Layer | Question it answers | Output | Trust source |
|---|---|
| **Curriculum alignment** | "Which curriculum area does this belong to?" | Theme / LO / ProcessComponent + confidence | Curriculum authority |
| **Skill mapping** | "Which MicroSkill must the solver actually use?" | `QuestionSkillMapping` rows | Pedagogical judgement |
| **Error analysis** | "Why did the student fail?" | `ErrorAnalysis` -> `ErrorPattern` | Attempt evidence |

These are **not** the same. A question can align to a curriculum area while a student's
error belongs to a completely different pattern.

### 5.2 Is a separate anchoring layer needed?

**Yes.** Reasoning:

- `Question -> MicroSkill` directly is what the previous phase showed is hard to do well.
  It jumps from "what is this question about" to "what exact 70-granularity skill is
  required", with no intermediate record of *why*.
- The curriculum hierarchy (`Theme -> LearningOutcome -> ProcessComponent -> MicroSkill`)
  is already materialized in the database. Anchoring at the **upper** level is a much easier
  and more reliable inference than anchoring at MicroSkill granularity.
- Anchoring is higher-confidence and more stable than skill mapping. Storing it separately
  means a bad skill mapping does not corrupt the curriculum record, and vice versa.

### 5.3 Are the 70 MicroSkills sufficient for direct Question mapping?

**Yes for a bank, no as the only anchor.**

- 70 MicroSkills covering 3 themes is a reasonable target set for **approved bank**
  questions, where a human confirms the mapping.
- It is **not** sufficient as the *first* inference step for an arbitrary student upload,
  because:
  - the upload may be off-curriculum entirely (as the 2 real questions in the corpus are),
  - MicroSkill granularity is too fine to infer reliably from a photo,
  - a wrong MicroSkill silently poisons mastery, whereas a wrong Theme is cheap to correct.

Therefore: **anchor coarse first, map fine second, and gate the fine step behind review.**

---

## 6. QUESTION -> CURRICULUM CANDIDATE

### 6.1 Verdict: a candidate layer IS warranted — but only one level of it

Do **not** build a candidate table that can point at all four levels at once. Analysis:

| Candidate level | Needed? | Why |
|---|---|---|
| Theme | **No** | Only 3 themes. Too coarse to be useful; the LO level is nearly as cheap and far more informative. |
| LearningOutcome | **Yes** | The natural "curriculum area" unit. 9 outcomes, stable identifiers (`MAT.11.x.y`). This is the right primary anchor. |
| ProcessComponent | **Yes, as optional** | Useful when the question clearly targets one component; often ambiguous. |
| MicroSkill | **No** — this belongs to `QuestionSkillMapping` | Mixing it in would re-conflate alignment with skill mapping (§5.1). |

### 6.2 Multiple candidates

**Yes, a question must be able to hold multiple candidates.** Real questions routinely span
areas (e.g. a statistics question that also requires reading a graph). The model must
therefore allow `1..N` candidates with per-candidate confidence, and permit a
`decision` (`PRIMARY` / `SECONDARY` / `REJECTED`) so that a rejected hypothesis is retained
as evidence rather than deleted.

### 6.3 Conceptual shape

```text
Question
  └── CurriculumCandidate (1..N)
        ├── level        : LEARNING_OUTCOME | PROCESS_COMPONENT
        ├── targetId     : FK to the level above
        ├── confidence   : Float            (inference certainty)
        ├── decision     : PENDING | PRIMARY | SECONDARY | REJECTED
        ├── source       : AI | HUMAN | RULE
        └── reviewed     : Boolean
```

Note the deliberate absence of a MicroSkill level — that stays in `QuestionSkillMapping`,
preserving the §5.1 separation.

---

## 7. QUESTION -> MICROSKILL MAPPING BOUNDARY

### 7.1 Carried forward unchanged from the prior phase

- Max **1 PRIMARY** per question; **0..N SECONDARY**.
- `isPrimary = true` -> PRIMARY, `false` -> SECONDARY. `PRIMARY = 2` is forbidden.
- `relevance` (Float) != `aiConfidence` (Float?) — distinct columns, distinct meanings.
- Low confidence -> `aiConfidence` low + `reviewed = false`.
- No new MicroSkills. No mapping to `ProcessComponent`/`LearningOutcome` in this table.
- No coverage inflation. Question -> ErrorPattern is out of scope.

### 7.2 The rubric: "related to" vs "cannot solve without"

This is the new question the brief asks, and it is the crux of PRIMARY vs SECONDARY.

**Test for SECONDARY** (necessary-condition test):
> *Could a competent student, who has mastered every other skill involved, still fail this
> question by lacking this one skill?*

If **yes** -> the skill is genuinely **required**. It is a candidate for the mapping.

**Test for PRIMARY** (measurement-target test):
> *If the student failed only this skill and nothing else, would the question's result be
> dominated by that failure — i.e. is this what the question is designed to measure?*

If **yes** -> **PRIMARY**. Exactly one skill may pass this test per question.

| | PRIMARY | SECONDARY | NOT MAPPED |
|---|---|
| Passes measurement-target test | ✅ | ❌ | ❌ |
| Passes necessary-condition test | ✅ | ✅ | ❌ |
| Meaning | The question measures this skill | Solver cannot proceed without it | Merely topically adjacent |

### 7.3 Worked example

```text
Question: "A dataset's scatter plot shows a strong negative association.
           Compute and interpret the correlation coefficient."

PRIMARY   : MS-MAT.11.1.1-d-03  "Korelasyon katsayısı yorumu"
            -> the measurement target; fail this and the question fails.

SECONDARY : MS-MAT.11.1.1-d-01  "Serpme diyagramı seçimi ve yorumu"
            -> you cannot start without reading the plot; necessary, not the target.

NOT MAPPED: MS-MAT.11.1.1-g-01  "Sonuç değerlendirme"
            -> topically adjacent; the question does not require it. Mapping it
               would be coverage inflation.
```

### 7.4 Anti-patterns to reject

- Mapping every MicroSkill under the anchored LearningOutcome (coverage inflation).
- Mapping a MicroSkill because the **topic** matches rather than the **task**.
- Adding SECONDARY rows "just in case".
- Using `relevance` to encode confidence.

---

## 8. QUESTION DIFFICULTY

### 8.1 The four quantities that must stay distinct

```text
Question difficulty   !=   Student mastery   !=   AI confidence   !=   Mapping relevance
```

| Quantity | What it is | Whose property | Changes when? |
|---|---|
| **Question difficulty** | Intrinsic demand of the task | The question | Rarely (only on re-calibration) |
| **Student mastery** | How well *this student* performs | The student x skill | Every attempt |
| **AI confidence** | Our certainty in a derived value | The inference | On re-inference |
| **Mapping relevance** | How strongly a skill relates to the question | The question x skill pair | On re-mapping |

### 8.2 Assessment of the current `difficulty` field

`Question.difficulty` is an `Int` defaulting to 1, and **158 of 159 rows are 1**. It is
currently a constant, carrying no information.

It is a **static, author-assigned property of the question** — not student-relative, not
dynamic, not mastery-derived. That is the correct MVP semantics. The bug is the data, not
the design.

### 8.3 MVP recommendation

1. **Keep `difficulty` as a static per-question property.** Do not make it adaptive in MVP.
2. **Do not use it in mastery computation.** Mastery must derive from *attempt outcomes*
   against the mapped skills, never from the question's nominal difficulty.
3. **Do not overload it.** Do not store student-specific difficulty there; that is what
   `SkillMastery` is for.
4. **Widen the scale cautiously** — the domain entity already validates `1..10`, the schema
   has no constraint. Align these during implementation.
5. Calibrating difficulty from live attempt data is a **later** optimization, and should be a
   separate derived value, never an overwrite of the authored one.

---

## 9. QUESTION QUALITY / REVIEW PIPELINE

### 9.1 Minimal viable state machine

The brief's proposed 7-state chain is **longer than MVP needs**. `EXTRACTED` and
`NORMALIZED` are useful as *substates* but do not each need to be a gating state. Proposed
minimum:

```text
        INGESTED
            |
            v
        EXTRACTED ──(extraction failed)──> EXTRACTION_FAILED
            |
            v
        NORMALIZED
            |
            v
        ANALYZED
            |
            v
        MAPPED
            |
     (needs human?)
        /       \
      no         yes
      |           |
      v           v
   APPROVED <── REVIEW_REQUIRED
                  |
                  v
              REJECTED
```

| State | Meaning | Exit condition |
|---|---|---|
| `INGESTED` | Raw input stored | payload persisted |
| `EXTRACTED` | OCR/text extraction done | `rawExtractedText` present |
| `EXTRACTION_FAILED` | OCR produced unusable output | human retry or reject |
| `NORMALIZED` | Usable stem produced | `normalizedText` present |
| `ANALYZED` | Curriculum candidates produced | >= 1 candidate, or `OFF_CURRICULUM` |
| `MAPPED` | MicroSkill mapping proposed | 1 PRIMARY proposed or none |
| `REVIEW_REQUIRED` | Awaiting human | human acts |
| `APPROVED` | Trusted | eligible for bank/session use |
| `REJECTED` | Not usable | terminal |

Terminal states: `APPROVED`, `REJECTED`. `EXTRACTION_FAILED` is terminal only if the
student does not retry.

### 9.2 How the brief's failure conditions map onto this

| Condition | Handling |
|---|---|
| **OCR failed** | `EXTRACTED` -> `EXTRACTION_FAILED`. Ask the student to re-photograph or type the question. Never proceed with garbage. |
| **Mathematical expression broken** | Stay in `NORMALIZED`; flag `parsingConfidence` low; route to `REVIEW_REQUIRED`. |
| **Off-curriculum** | `ANALYZED` with zero candidates -> terminal `REJECTED` (or a dedicated `OFF_CURRICULUM` outcome). Do **not** force a MicroSkill. This is exactly the situation of the 2 real questions in the current corpus. |
| **Multiple plausible MicroSkills** | Allowed. One `PRIMARY`, rest `SECONDARY`. Genuine ambiguity -> `REVIEW_REQUIRED`. |
| **Low AI confidence** | Any confidence below threshold -> `REVIEW_REQUIRED`, never auto-`APPROVED`. |
| **Human review needed** | The single gate. Only humans move a row to `APPROVED`. |

### 9.3 The rule that matters

```text
No path exists from INGESTED to APPROVED that does not pass through a human
decision when confidence is below threshold.
```

Student uploads and AI derivations must **not** be able to reach `APPROVED` autonomously.

---

## 10. STUDENT-UPLOADED QUESTION vs MASTER QUESTION

### 10.1 The scenario

```text
Student A, Monday  -> photo -> Question X
Student A, Friday  -> photo -> (the same Question X?)
Student B         -> photo -> (the same Question X?)
```

### 10.2 Does the current model support this?

**No.** Today `QuestionAttempt.questionId` FKs directly to `Question`. To attach two
uploads of the same question you would either:

- create **two** `Question` rows -> the canonical entity is duplicated, mastery fragments, or
- reuse **one** `Question` row -> the student's own photo is lost.

The current model cannot distinguish *the canonical question* from *this student's upload
of it*.

### 10.3 Recommendation

**Yes — a canonical/instance split is needed.** The chain:

```text
Canonical Question              (the mathematics; deduplicated; reusable)
      |
      v
QuestionInstance / Submission   (one upload: who, when, which image, which OCR run)
      |
      v
QuestionAttempt                 (one solving event)
```

Rationale:

- **Canonical Question** is deduplicated: the same mathematics should exist once, so
  mastery aggregates correctly across students.
- **QuestionInstance** preserves the student-specific artifact (the photo, the OCR output,
  the extraction confidence) without polluting the canonical row.
- **QuestionAttempt** stays attached to the instance for the upload case, while
  bank questions can have attempts with no instance.

### 10.4 Where each thing lives

| Data | Home | Reason |
|---|---|---|
| The mathematics (stem, options, answer) | Canonical `Question` | Shared, deduplicated |
| Student-specific image | `QuestionInstance` | Personal, may be deleted on request |
| Raw OCR text + confidence | `QuestionInstance` | Per-extraction, not per-question |
| `uploadedBy` | `QuestionInstance` | Ownership/access control |
| The solving event | `QuestionAttempt` | Unchanged |

### 10.5 On deduplication — be honest about the limit

True canonical dedup requires deciding "are these two texts the same question?". For OCR'd
photographs this is genuinely hard. MVP recommendation:

- **Do not** attempt automated semantic dedup of student photos.
- **Do** dedup **bank** questions on an explicit author-controlled key (e.g.
  `(source, sourceReference)` or a content hash).
- Treat student-upload dedup as a **later** capability. Over-engineering it now risks
  wrongly merging two genuinely different questions, which corrupts mastery far worse than
  keeping duplicates.

---

## 11. COPYRIGHT / PROVENANCE / EXTERNAL SOURCE

### 11.1 What MVP actually needs

| Concept | MVP? | Why |
|---|---|---|
| `source` (origin) | **Required** | Separates bank from student upload. Everything else depends on it. |
| `sourceType` | **Required** | Coarse classifier driving the trust rules. |
| `uploadedBy` | **Required** for uploads | Ownership and access control. |
| `sourceReference` | **Optional** | External id / book+page when known. Cheap to add, valuable when present. |
| `license` | **Optional, but recommended for LICENSED_BANK** | Legal safety for licensed content. |
| `externalReference` (URL) | **Optional** | Provenance nicety. |
| `ownership` (full rights model) | **Defer** | Over-modelled for MVP; `uploadedBy` + `source` covers the need. |

### 11.2 The rule the brief asks about

> *"Öğrencinin yüklediği bir sorun Mentora Question Bank'e otomatik olarak dahil
> edilmemesi gerektiğini değerlendir."*

**Agreed, and it should be enforced structurally, not by convention:**

```text
Student-uploaded -> never auto-enters the bank.
Promotion requires: explicit human review + trust = HUMAN_APPROVED.
```

This matters for two independent reasons:

1. **Copyright** — a student upload may be a photograph of a copyrighted textbook page.
   Promoting it into a "bank" redistributes third-party content.
2. **Quality** — an unverified student question may be mis-transcribed, incomplete, or
   simply wrong. Feeding it to other students would propagate the error.

Recommended: keep student uploads in a state that is **excluded from session/assessment
selection by default**, and make bank membership a deliberate, audited promotion.

---

## 12. TEST FIXTURE STRATEGY

### 12.1 Facts that constrain the decision

- All 86 tests run against **`backend/prisma/test.db`**, forced by `tests/setup.ts:14`.
- `beforeEach` (`tests/setup.ts:144-185`) **deletes every table** before each test.
- Therefore the tests **create their own questions inline** and **never read `dev.db`**.
- The 159 rows live only in **`dev.db`**.

**Conclusion: the 159 rows in `dev.db` are not used by any test.** They cannot be, because
the test DB is a different file and is emptied before each test.

### 12.2 Options evaluated

| Option | Verdict |
|---|---|
| **Delete the 159 rows** | ❌ Rejected as a first move. Destructive, and unnecessary — they harm nothing where they are. |
| **Keep as seed fixture unchanged** | ⚠️ Acceptable as a *holding* state, but leaves 159 confusing rows indistinguishable from real data in `dev.db`. |
| **Mark with a fixture namespace / sourceType** | ✅ **Recommended.** Cheap, non-destructive, immediately disambiguates. |
| **Leave as-is until real seed arrives** | ⚠️ Same as "keep", but without the disambiguation. |

### 12.3 Recommendation

```text
1. Make the dev/test separation EXPLICIT and permanent.
   Tests keep using prisma/test.db. dev.db is never a test dependency.

2. Label the 159 dev rows as fixtures at the next schema change
   (e.g. sourceType = 'FIXTURE' / a dedicated flag), so no future reader
   mistakes them for a question bank.

3. Do NOT delete them, and do NOT rewrite them in this design phase.
   86/86 must stay green; changing dev.db data is out of scope here.

4. Real question data lands in a NEW seed, not by mutating the fixtures.
```

### 12.4 Should fixtures and production data be separated?

**Yes.** The separation already exists at the *database-file* level (test.db vs dev.db) and
that is the strongest form. The remaining gap is **labelling** — making fixture rows
self-identifying inside `dev.db`. That is a small, additive change and should ride along with
the next real schema migration rather than be done on its own.

---

## 13. IS THE CURRENT QUESTION MODEL SUFFICIENT?

### Decision: **B — sufficient with a small, additive extension.**

Not **A**, because provenance, ingest state, raw/instance storage and curriculum anchoring
have nowhere to live, and those are the whole point of this phase.

Not **C**, because the existing `Question` / `QuestionOption` / `QuestionAttempt` /
`QuestionSkillMapping` models are well-formed and already carry the essential columns
(`content`, `correctAnswer`, `type`, `difficulty`, `explanation`, `isActive`). The spine is
reusable; what is missing is **additive**.

### 13.1 What is added (conceptually — no schema is written here)

| Model | New? | Purpose |
|---|---|---|
| `QuestionSource` / provenance fields | **New** (fields on Question, or a small model) | origin, sourceType, sourceReference, license, uploadedBy |
| `QuestionIngestion` (raw) | **New** | raw text, image ref, OCR confidence, state machine |
| `QuestionInstance` / `Submission` | **New** | per-upload artifact, links student -> canonical |
| `CurriculumCandidate` | **New** | Question -> LO/ProcessComponent anchoring |
| `Question`, `QuestionOption`, `QuestionAttempt`, `QuestionSkillMapping`, `MicroSkill` | **Unchanged** | reusable spine |

### 13.2 Why alternatives were rejected

| Alternative | Rejected because |
|---|---|
| Put OCR text + image directly on `Question` | Collapses three trust levels into one row (§3.3); makes student uploads indistinguishable from bank questions; forces one `Question` row per upload, breaking dedup. |
| Widen `Question` with a `sourceType` string only (brief's option B) | Insufficient — it records origin but not *state*, *raw text*, or *image*. The whole pipeline is still unrepresentable. |
| Skip the candidate layer and map straight to MicroSkill | Proven by the previous phase to be unreliable at 70-way granularity from a photo; loses the *reason* for a mapping; conflates alignment with skill mapping (§5.1). |
| Store everything in `Question.metadata` (a JSON string) | `metadata` is unvalidated, unindexed, un-FK'd, and currently NULL on all 159 rows. Using it as the primary home for core fields would make integrity impossible to enforce. |
| Full re-modeling (option C) | Unnecessary churn. The spine is sound; rewriting it would risk the 86 green tests and buy nothing. |

### 13.3 Migration required?

**Yes — a migration will be required**, but it is **additive only**:

- new tables and new nullable columns,
- no destructive change to `Question`, `QuestionAttempt`, or `QuestionSkillMapping`,
- existing 86 tests must continue to pass unchanged.

**This phase writes no migration.** It is specified in
`question-ingestion-schema-proposal.md`.

---

## 14. MVP ARCHITECTURE

The recommended flow, reflecting the analysis above (notably: **two entry paths**, a
**raw/instance layer**, **coarse anchoring before fine mapping**, and a **mandatory human
gate**):

```text
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  SOURCE A                    │        │  SOURCE B                    │
│  Mentora Question Bank       │        │  Student External Question   │
│  (MEB / licensed / manual)   │        │  (photo / OCR / typed / PDF) │
└───────────────┬──────────────┘        └───────────────┬──────────────┘
                │                                       │
                │                                       v
                │                          ┌─────────────────────────┐
                │                          │  INGESTION (raw)        │
                │                          │  image ref, raw text,   │
                │                          │  OCR confidence, state  │
                │                          └────────────┬────────────┘
                │                                       │
                │                          ┌────────────v────────────┐
                │                          │  NORMALIZATION          │
                │                          │  normalizedText,        │
                │                          │  parsing confidence     │
                │                          └────────────┬────────────┘
                │                                       │
                v                                       v
        ┌───────────────────────────┐
        │            CANONICAL QUESTION  (deduplicated)              │
        └───────────────┬───────────────────────────┬───────────────┘
                        │                           │
                        v                           v
        ┌───────────────────────────┐   ┌───────────────────────────┐
        │ CURRICULUM ANCHORING      │   │  REVIEW GATE              │
        │ Question                  │   │  (human, mandatory below  │
        │   -> CurriculumCandidate  │   │   confidence threshold)    │
        │      -> LearningOutcome   │   └────────────┬──────────────┘
        │      -> ProcessComponent  │                │
        └───────────────┬───────────┘                │
                        │                            │
                        v                            │
        ┌───────────────────────────┐                │
        │ SKILL MAPPING             │                │
        │ QuestionSkillMapping      │                │
        │   PRIMARY x1, SECONDARY xN│                │
        └───────────────┬───────────┘                │
                        │                            │
                        └──────────────┬─────────────┘
                                       v
                            ┌─────────────────────┐
                            │  APPROVED Question  │
                            └──────────┬──────────┘
                                       │
                 (student solves)      v
                            ┌─────────────────────┐
                            │  QuestionInstance   │
                            │  (upload, if any)   │
                            └──────────┬──────────┘
                                       v
                            ┌─────────────────────┐
                            │  QuestionAttempt    │
                            └──────────┬──────────┘
                                       v
                            ┌─────────────────────┐
                            │  ErrorAnalysis      │
                            │   -> ErrorPattern   │
                            └──────────┬──────────┘
                                       v
                            ┌─────────────────────┐
                            │  Mastery / Profile  │
                            └─────────────────────┘
```

Key properties of this architecture:

1. **Bank and student upload converge on the same canonical `Question`**, but arrive via
   different trust paths.
2. **The raw layer is preserved**, so the original image and OCR text are never lost.
3. **Anchoring is coarse-to-fine**: LO/ProcessComponent first, MicroSkill second.
4. **The human gate is on the path**, not optional.
5. **The downstream chain (`Attempt -> ErrorAnalysis -> Mastery`) is unchanged** — the
   existing models already support it.

---

## 15. RISKS

| # | Risk | Impact | Mitigation |
|---|---|
| 1 | Student upload auto-promoted to bank | Copyright + propagating wrong questions | Structural: `APPROVED`+`HUMAN_APPROVED` required; no autonomous path (§11.2) |
| 2 | Over-eager MicroSkill mapping from photos | Corrupted mastery | Coarse-first anchoring; `REVIEW_REQUIRED` below threshold; `reviewed=false` default (§9) |
| 3 | Automated dedup wrongly merges distinct questions | Corruption worse than duplication | Do not auto-dedup student photos in MVP; bank dedup on explicit keys only (§10.5) |
| 4 | Two divergent `Question.type` vocabularies | Silent data corruption at the boundary | Pick one canonical vocabulary during implementation (§1.4) |
| 5 | Test fixtures contaminated by real data | 86/86 breaks | Fixtures labelled, not deleted; test.db isolation preserved (§12.3) |
| 6 | Confidence conflated with relevance | Bad routing and bad review decisions | Separate columns already exist; enforce in code and tests (§7.1) |
| 7 | OCR garbage entering the pipeline | Meaningless mappings | `EXTRACTION_FAILED` terminal state; `ocrConfidence` gate (§9.2) |
| 8 | Additive migration drifting destructive | Data loss on existing tables | Migration must be additive-only; existing tests must stay green (§13.3) |
| 9 | Off-curriculum questions forced onto a MicroSkill | Misleading curriculum coverage | Explicit off-curriculum outcome; never force (proven need: the 2 real questions) (§9.2) |
| 10 | `metadata` JSON used as an escape hatch | Unenforceable integrity | Core fields go in typed columns, never `metadata` (§13.2) |

---

## 16. FINAL RECOMMENDATION

1. **Adopt option B** — the existing Question spine is sound and is kept; the missing
   capabilities (provenance, raw ingestion, instances, curriculum candidates) are added
   **additively**.
2. **Introduce three orthogonal axes** — `origin`, `derivation`, `trust` — rather than one
   overloaded `source`.
3. **Keep raw and canonical strictly separate** — three trust levels, three homes.
4. **Anchor coarse-first** (LO / ProcessComponent) via a `CurriculumCandidate` layer, and
   map to MicroSkill second, through `QuestionSkillMapping` exactly as previously designed.
5. **Keep alignment / skill mapping / error analysis structurally distinct** — they answer
   three different questions.
6. **Preserve the PRIMARY=1, SECONDARY=0..N rubric**, with the necessary-condition and
   measurement-target tests from §7.2.
7. **Make the human review gate non-bypassable** below a confidence threshold.
8. **Never auto-promote student uploads** into the question bank.
9. **Label — do not delete — the 159 dev fixtures**, and keep the 86/86 suite green.
10. **Write an additive-only migration** in the implementation phase; none is written here.

The detailed model-level proposal, including invariants and indexes, is in
`question-ingestion-schema-proposal.md`.
