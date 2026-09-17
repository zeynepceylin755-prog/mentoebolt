# QuestionSkillMapping Design Review

## STATUS

**`BLOCKED_DATA_QUALITY`**

The mapping schema and semantics are sound and require no change. The design work is
complete. However, the existing `Question` corpus cannot support any defensible
`Question -> MicroSkill` mapping, so **no mappings were produced**.

---

## 1. SCOPE

This phase designed the `Question -> QuestionSkillMapping -> MicroSkill` layer.

| In scope | Out of scope |
|---|---|
| Mapping semantics (PRIMARY / SECONDARY) | Seeding QuestionSkillMapping |
| relevance vs confidence separation | Question -> ErrorPattern mapping |
| Mapping JSON shape | ErrorAnalysis changes |
| Question corpus quality assessment | Mastery algorithm changes |
| Coverage analysis | Frontend changes |
| Curriculum alignment chain | Migration creation |

No database write was performed. No migration was created. The 86 existing tests were not
modified.

---

## 2. SCHEMA REVIEW

Models reviewed: `Question`, `QuestionSkillMapping`, `MicroSkill`, `ProcessComponent`,
`LearningOutcome`, `Theme`.

### Verdict: **No schema change required.**

`QuestionSkillMapping` already carries every field this design needs:

| Field | Type | Purpose in this design |
|---|---|---|
| `questionId` | `String` | FK to Question |
| `microSkillId` | `String` | FK to MicroSkill |
| `relevance` | `Float` | "How related is this MicroSkill to the question?" |
| `isPrimary` | `Boolean` | PRIMARY vs SECONDARY discriminator |
| `aiConfidence` | `Float?` | "How sure are we the mapping is correct?" (nullable) |
| `mappingSource` | `String` | Provenance, e.g. `MANUAL_REVIEW` |
| `reviewed` | `Boolean` | Human sign-off flag |
| `@@unique([questionId, microSkillId])` | — | Guarantees deterministic, duplicate-free mappings |

### relevance vs confidence

These are held in **distinct** fields and must never be conflated:

- `relevance` -> **`relevance`** (`Float`)
- `confidence` -> **`aiConfidence`** (`Float?`)

The nullable `aiConfidence` is exactly the low-confidence lever. A mapping whose correctness
is uncertain is expressible as `aiConfidence: <low value>` with `reviewed: false`, i.e. the
"review_required" state. **No new field was added** — the schema already supports it.

### Enforcement gap noted (informational, not a blocker for this phase)

"Exactly 1 PRIMARY per question" is a set-level invariant. The schema enforces uniqueness of
`(questionId, microSkillId)` but **cannot** enforce "at most one row per question with
`isPrimary = true`". This must therefore be enforced by the seeding script and asserted by a
test. It is not a schema deficiency — it is a constraint that belongs to the writer. Flagging
it now so the seeding phase does not overlook it.

### `Question.skillId` observation

`Question.skillId` is a **required free-text** field and is *not* linked to `MicroSkill`.
Its current values (`skill1`, `skill-1`, `skill-complete`, ...) are unrelated to the knowledge
layer. It must **not** be treated as an existing MicroSkill mapping. `QuestionSkillMapping`
is the correct and only bridge.

---

## 3. QUESTION CORPUS ASSESSMENT

159 questions were read and classified.

### 3.1 Structural findings

| Attribute | Observation |
|---|---|
| Total questions | 159 |
| Distinct content strings | **16** (heavy duplication) |
| Questions with real mathematical content | **2** |
| Questions with options (`QuestionOption`) | **2** (4 options each) |
| Questions whose `type` is `MULTIPLE_CHOICE` | 158 |
| `difficulty` = 1 | 158 |
| `learningObjectiveId` = NULL | **159 (all)** |
| `metadata` populated | **0 (none)** |
| `explanation` populated | 2 |
| `skillId` values | synthetic (`skill1`..`skill11`, `skill-1`, `skill-complete`) |

### 3.2 Content classification

| Class | Count | Mappable | Description |
|---|---|
| `PLACEHOLDER_ARITHMETIC` | **130** | No | Single-digit drills, e.g. `"What is 2 + 2?"` -> `4` |
| `PLACEHOLDER_GENERIC` | **27** | No | Literal placeholders, e.g. `"Question 1"`, `"Test question"` |
| `OUT_OF_CURRICULUM_TOPIC` | **2** | No | Real math, wrong curriculum: linear functions |
| **Total** | **159** | **0** | |

### 3.3 The two questions with real content

1. `cmtvpe8cq0002ytx2v9ahw95z` — `"f(x) = 2x + 3 fonksiyonu için f(2) değeri kaçtır?"` -> `7`
2. `cmtvpe8cr0007ytx2gvatriqr` — `"Aşağıdakilerden hangisi bir fonksiyon değildir?"` -> `0`

These are genuine mathematics but they concern **functions**, which is not among the
grade-11 Themes in the MicroSkill set (see §6). There is no valid mapping target, so mapping
them would mean inventing a relationship that the curriculum does not support.

### 3.4 Answers to the required evaluation questions

| Question | Answer |
|---|---|
| Are these really grade-11 mathematics questions? | **No.** 130 are primary-school arithmetic drills; 27 are placeholder strings; 2 are grade-10 function questions. |
| Is the question text sufficient? | **No** for 157 of 159. Only 2 have meaningful mathematical text, and both are off-curriculum. |
| Is identifying a MicroSkill possible? | **No.** No question expresses a task that corresponds to any of the 70 MicroSkills. |
| Do questions measure more than one MicroSkill? | **Unanswerable** — no question maps to even one MicroSkill. |

### 3.5 Verdict

The corpus is **seeded development/test fixture data**, not a curriculum-aligned question
bank. Producing mappings from it would fabricate pedagogy rather than represent it.

---

## 4. WHY NO MAPPINGS WERE FORCED

The critical pedagogical test (§17 of the brief) was applied to every candidate:

> "Would a student solving this question genuinely need to use this MicroSkill?"

Every candidate failed it. Examples:

- `"What is 2 + 2?"` — no grade-11 MicroSkill (scatter plots, correlation, prisms, nets,
  trigonometric functions, ...) is exercised by single-digit addition.
- `"Question 1"` — there is no mathematical task at all, so no behaviour can be attributed.
- `"f(x) = 2x + 3 ... f(2)"` — the solver evaluates a linear function. None of the 70
  MicroSkills describe function evaluation, because grade-11 does not teach it here.

Per the brief: *"Sırf coverage yükseltmek için mapping yapma."* — no mapping was created to
inflate coverage. **Coverage is reported honestly as 0%.**

---

## 5. MAPPING SEMANTICS (DESIGN, VALIDATED)

The following rules were designed and are encoded in
`question-skill-mapping-data.json`. They are correct and await a mappable corpus.

```text
Question
   |
   v
QuestionSkillMapping
   |
   v
MicroSkill
```

| Rule | Definition |
|---|---|
| PRIMARY | The one MicroSkill the question is fundamentally designed to measure. **Exactly 1** per mapped question. |
| SECONDARY | A MicroSkill genuinely required to solve it, but not the measurement target. **0..N**. |
| Forbidden | `PRIMARY = 2` for any question. |

```text
PRIMARY = 1, SECONDARY = 0..N   -- permitted
PRIMARY = 2                     -- forbidden
```

Selection procedure for each question:
1. What mathematical behaviour does the question demand?
2. Which MicroSkill defines that behaviour?
3. Is the MicroSkill genuinely required to solve it?
4. Primary or secondary?
5. Is the mapping confidence sufficient?

---

## 6. CURRICULUM ALIGNMENT

Every MicroSkill sits on the required chain:

```text
MicroSkill
   |
   v
ProcessComponent
   |
   v
LearningOutcome
   |
   v
Theme
```

Verified against the database. The 70 MicroSkills resolve to exactly **3 Themes**,
**9 LearningOutcomes**, and **60 ProcessComponents**:

| Theme | MicroSkills | LearningOutcome codes |
|---|---|---|
| İstatistiksel Araştırma Süreci | 18 | MAT.11.1.1, MAT.11.1.2 |
| Geometrik Şekiller | 28 | MAT.11.2.1 .. MAT.11.2.5 |
| Nitelikler ve Değişimler (1) | 24 | MAT.11.3.1, MAT.11.3.2 |
| **Total** | **70** | |

### Worked chain examples

**Example A — a MicroSkill that a future question could target**

```text
MS-MAT.11.1.1-d-03  "Korelasyon katsayısı yorumu"
   -> ProcessComponent  PCd        (under LO MAT.11.1.1)
   -> LearningOutcome   MAT.11.1.1
   -> Theme             İstatistiksel Araştırma Süreci
```

**Example B**

```text
MS-MAT.11.2.5-a-01  (geometric constraint skill)
   -> ProcessComponent  PCa        (under LO MAT.11.2.5)
   -> LearningOutcome   MAT.11.2.5
   -> Theme             Geometrik Şekiller
```

**Example C**

```text
MS-MAT.11.3.2-b-01  (trigonometric equation component relationship)
   -> ProcessComponent  PCb        (under LO MAT.11.3.2)
   -> LearningOutcome   MAT.11.3.2
   -> Theme             Nitelikler ve Değişimler (1)
```

### Alignment conclusion

The MicroSkill side of the chain is healthy and complete. The break is entirely on the
Question side: no existing question belongs to any of these Themes.

---

## 7. QUALITY CONTROL

### 7.1 QUESTION COVERAGE

| Metric | Value |
|---|---|
| Total Question | 159 |
| Mapped Question | **0** |
| Unmapped Question | **159** |
| Coverage | **0.0%** |

### 7.2 MICROSKILL COVERAGE

| Metric | Value |
|---|---|
| Total MicroSkill | 70 |
| MicroSkills measured by >= 1 question | **0** |
| MicroSkills never measured by a question | **70** |

All 70 MicroSkills are currently unmeasured. This is a direct consequence of §7.1.

### 7.3 PRIMARY

| Metric | Value |
|---|---|
| Total primary mappings | **0** |
| Questions with exactly 1 primary | 0 |
| Questions with 0 primaries | 159 |
| Questions with >1 primary (must be 0) | **0** ✅ |

The `PRIMARY = 2` prohibition is not violated because no mapping exists.

### 7.4 SECONDARY

| Metric | Value |
|---|---|
| Total secondary mappings | **0** |

### 7.5 CONFIDENCE

| Band | Count |
|---|---|
| high (`aiConfidence >= 0.8`) | 0 |
| medium (`0.5 <= aiConfidence < 0.8`) | 0 |
| low (`aiConfidence < 0.5` or `null`) | 0 |
| **Total** | **0** |

No low-confidence mappings were emitted, because emitting a mapping with unverifiable
confidence would violate the "do not force mappings" rule.

---

## 8. DETERMINISM

Even though no mappings were produced, the design is deterministic by construction:

- The target key is `(questionId, microSkillCode)`, matching the schema's
  `@@unique([questionId, microSkillId])`. Duplicates are impossible at the database level.
- `microSkillCode` is used as the stable external identifier (never the cuid), so the
  same input always resolves to the same relation.
- Re-evaluating the same Question + MicroSkill pair yields the same `isPrimary`,
  `relevance`, `aiConfidence` and `mappingSource`.
- The mapping artifact is sorted by `questionId` then `microSkillCode`.

---

## 9. LOW-CONFIDENCE HANDLING

The schema supports low-confidence / review-required mappings without modification:

| Concept | Field |
|---|---|
| Low confidence | `aiConfidence` = low value, or `null` when unknown |
| review_required | `reviewed = false` |
| Provenance | `mappingSource = "MANUAL_REVIEW"` |

The design uses `reviewed = false` for every proposed row, so nothing is treated as
approved until a human signs off. No new field was added.

---

## 10. WHAT IS NEEDED TO UNBLOCK

The design is ready; the data is not. To proceed to the seeding phase:

1. **Supply a real question bank** of grade-11 MEB-aligned mathematics questions covering
   the three Themes (statistical research process, geometric shapes, quantities and change).
2. **Populate `Question.learningObjectiveId`** — currently NULL for all 159 rows. This gives a
   curriculum anchor to constrain candidate MicroSkills.
3. **Populate `Question.metadata`** with topic/tag data — currently empty for all 159 rows.
4. **Provide `QuestionOption` rows** for MC items — only 2 currently exist.
5. Optionally **clean the placeholder rows** out of the dev corpus, or mark them, so they are
   not mistaken for mappable content later.

Once a curriculum-aligned corpus exists, the mapping procedure in §5 can be applied directly
and the JSON in `question-skill-mapping-data.json` can be filled in and seeded.

---

## 11. FILES PRODUCED

| File | Status |
|---|---|
| `backend/prisma/question-skill-mapping-data.json` | **New** — design artifact, not seeded |
| `backend/prisma/question-skill-mapping-review.md` | **New** — this review |

No database changes. No migrations. No changes to Question, MicroSkill, ErrorPattern,
ErrorAnalysis, or Mastery. The 86 existing tests are untouched and were not run against any
new code.

---

## 12. FINAL DECISION

**`BLOCKED_DATA_QUALITY`**

- Schema: **adequate, no change required**.
- Mapping semantics: **designed and validated**.
- Curriculum chain: **verified intact on the MicroSkill side**.
- Question corpus: **not usable** — 159/159 unmapped, 0% coverage.
- No mappings were forced. No coverage was inflated.
