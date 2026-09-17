import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Phase 5A — Question Ingestion Schema Integrity Tests
 *
 * These tests verify the additive database foundation added in Phase 5A:
 *   QuestionSource, QuestionIngestion, QuestionInstance, CurriculumCandidate
 * plus the new nullable columns on Question and QuestionAttempt.
 *
 * Scope note: no OCR, parsing, AI mapping, ingestion service or API exists yet.
 * These tests exercise the schema layer only, using Prisma directly.
 */
describe('Question Ingestion Schema Integrity - Phase 5A', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL || 'file:./dev.db',
        },
      },
    });
    await prisma.$connect();
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Child -> parent order. Includes the curriculum chain this suite builds
    // locally so no test can observe another test's fixtures.
    await prisma.questionSkillMapping.deleteMany();
    await prisma.questionAttempt.deleteMany();
    await prisma.questionInstance.deleteMany();
    await prisma.curriculumCandidate.deleteMany();
    await prisma.questionIngestion.deleteMany();
    await prisma.question.deleteMany();
    await prisma.questionSource.deleteMany();
    await prisma.microSkill.deleteMany();
    await prisma.processComponent.deleteMany();
    await prisma.learningOutcome.deleteMany();
    await prisma.theme.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.studentProfile.deleteMany();
    await prisma.user.deleteMany();
  });

  // ---------------------------------------------------------------- helpers
  /**
   * Build a self-contained curriculum chain for this suite:
   *   CurriculumVersion -> Theme -> LearningOutcome -> ProcessComponent -> MicroSkill
   * The test DB is not seeded, so every test that needs curriculum context
   * creates its own fixtures.
   */
  async function createCurriculumChain() {
    const version = await prisma.curriculumVersion.create({
      data: {
        code: 'P5A-CUR', name: 'Phase 5A Curriculum', grade: 11,
        subject: 'Matematik', version: '1.0', source: 'TEST_FIXTURE',
      },
    });
    const theme = await prisma.theme.create({
      data: {
        curriculumVersionId: version.id, officialCode: 'P5A.T1',
        name: 'Phase 5A Theme', lessonHours: 10, sourceOrder: 1,
      },
    });
    const learningOutcome = await prisma.learningOutcome.create({
      data: {
        themeId: theme.id, officialCode: 'P5A.LO-1',
        officialText: 'Phase 5A learning outcome', sourceOrder: 1,
      },
    });
    const processComponent = await prisma.processComponent.create({
      data: {
        learningOutcomeId: learningOutcome.id, officialCode: 'P5A.PC-1',
        officialText: 'Phase 5A process component', sourceOrder: 1,
      },
    });
    const microSkill = await prisma.microSkill.create({
      data: {
        processComponentId: processComponent.id, code: 'P5A.MS-1',
        name: 'Phase 5A microskill', description: 'Phase 5A microskill',
        source: 'TEST_FIXTURE',
      },
    });
    return { version, theme, learningOutcome, processComponent, microSkill };
  }

  async function createStudent(email = 'p5a-student@example.com') {
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Phase5A',
        lastName: 'Student',
        passwordHash: 'hash',
      },
    });
    const student = await prisma.studentProfile.create({
      data: { userId: user.id, grade: 11, school: 'Test School' },
    });
    return student;
  }

  async function createQuestion(overrides: Record<string, unknown> = {}) {
    return prisma.question.create({
      data: {
        content: 'f(x) = 2x + 3 fonksiyonu için f(2) değeri kaçtır?',
        type: 'CALCULATION',
        difficulty: 1,
        skillId: 'skill-1',
        correctAnswer: '7',
        ...overrides,
      },
    });
  }

  // ------------------------------------------------------- Test 1

  it('Test 1: new Question columns are additive and default correctly', async () => {
    const question = await createQuestion();

    // Existing data survives and new columns carry safe defaults.
    expect(question.id).toBeTruthy();
    expect(question.content).toContain('f(x)');
    expect(question.correctAnswer).toBe('7');
    expect(question.difficulty).toBe(1);
    expect(question.skillId).toBe('skill-1');

    // Phase 5A columns.
    expect(question.trust).toBe('UNVERIFIED');
    expect(question.isFixture).toBe(false);
    expect(question.sourceId).toBeNull();
    expect(question.origin).toBeNull();
    expect(question.sourceReference).toBeNull();
    expect(question.canonicalKey).toBeNull();
  });

  // ------------------------------------------------------- Test 2

  it('Test 2: new QuestionAttempt column is additive and nullable', async () => {
    const student = await createStudent();
    const question = await createQuestion();

    const attempt = await prisma.questionAttempt.create({
      data: {
        studentId: student.id,
        questionId: question.id,
        answer: '7',
        isCorrect: true,
        timeSpentSeconds: 30,
      },
    });

    // Existing behaviour unchanged: no instance required.
    expect(attempt.instanceId).toBeNull();
    expect(attempt.isCorrect).toBe(true);
    expect(attempt.status).toBe('COMPLETED');
  });

  // ------------------------------------------------------- Test 3

  it('Test 3: QuestionSource relation works and links to Questions', async () => {
    const source = await prisma.questionSource.create({
      data: {
        code: 'MEB-11-MATH',
        name: 'MEB 11th Grade Mathematics',
        origin: 'MEB',
        trustCeiling: 'HUMAN_APPROVED',
      },
    });

    const question = await createQuestion({
      sourceId: source.id,
      origin: source.origin,
      trust: 'HUMAN_APPROVED',
      sourceReference: 'MEB p.42 q.3',
    });

    const loaded = await prisma.question.findUnique({
      where: { id: question.id },
      include: { source: true },
    });

    expect(loaded?.source?.code).toBe('MEB-11-MATH');
    expect(loaded?.origin).toBe('MEB');
    expect(loaded?.sourceReference).toBe('MEB p.42 q.3');

    const bySource = await prisma.question.findMany({ where: { sourceId: source.id } });
    expect(bySource).toHaveLength(1);
  });

  // ------------------------------------------------------- Test 4

  it('Test 4: QuestionIngestion relation works and links raw input to a canonical Question', async () => {
    const source = await prisma.questionSource.create({
      data: {
        code: 'STUDENT-UPLOAD',
        name: 'Student Uploaded',
        origin: 'STUDENT_UPLOADED',
        trustCeiling: 'UNVERIFIED',
      },
    });

    const question = await createQuestion();

    const ingestion = await prisma.questionIngestion.create({
      data: {
        sourceId: source.id,
        ingestMethod: 'IMAGE_UPLOAD',
        originalAssetRef: 's3://bucket/scan-001.jpg',
        originalAssetMimeType: 'image/jpeg',
        originalAssetSizeBytes: 204800,
        rawExtractedText: 'f(x) = 2x + 3 ... f(2) = ?',
        ocrConfidence: 0.87,
        normalizedText: 'f(x) = 2x + 3 fonksiyonu için f(2) değeri kaçtır?',
        parsingConfidence: 0.9,
        state: 'APPROVED',
        requiresReview: false,
        resultingQuestionId: question.id,
      },
    });

    expect(ingestion.state).toBe('APPROVED');
    expect(ingestion.ocrConfidence).toBeCloseTo(0.87);
    expect(ingestion.resultingQuestionId).toBe(question.id);

    // `Question.ingestions` is a SINGULAR optional relation
    // (`ingestions QuestionIngestion? @relation("QuestionIngestionResult")`):
    // QuestionIngestion.resultingQuestionId is @unique, so a canonical Question
    // is produced by at most one ingestion. The relation therefore resolves to
    // that single record (or null), never an array. The earlier expectation of an
    // array was a test-expectation bug; the schema was (correctly) left unchanged.
    const withIngestion = await prisma.question.findUnique({
      where: { id: question.id },
      include: { ingestions: true },
    });
    expect(withIngestion?.ingestions).not.toBeNull();
    expect(withIngestion?.ingestions?.id).toBe(ingestion.id);

    const byState = await prisma.questionIngestion.findMany({ where: { state: 'APPROVED' } });
    expect(byState).toHaveLength(1);

    const bySource = await prisma.questionIngestion.findMany({ where: { sourceId: source.id } });
    expect(bySource).toHaveLength(1);
  });

  // ------------------------------------------------------- Test 5

  it('Test 5: QuestionInstance relation works and links student, question and ingestion', async () => {
    const student = await createStudent();
    const question = await createQuestion();

    const ingestion = await prisma.questionIngestion.create({
      data: {
        ingestMethod: 'IMAGE_UPLOAD',
        rawExtractedText: 'raw ocr output',
        state: 'INGESTED',
      },
    });

    const instance = await prisma.questionInstance.create({
      data: {
        questionId: question.id,
        ingestionId: ingestion.id,
        studentId: student.id,
        assetRef: 's3://bucket/student-a-scan.jpg',
        assetMimeType: 'image/jpeg',
        assetHash: 'abc123',
      },
    });

    expect(instance.questionId).toBe(question.id);
    expect(instance.studentId).toBe(student.id);
    expect(instance.ingestionId).toBe(ingestion.id);

    const loaded = await prisma.questionInstance.findUnique({
      where: { id: instance.id },
      include: { question: true, student: true, ingestion: true },
    });
    expect(loaded?.question.id).toBe(question.id);
    expect(loaded?.student?.id).toBe(student.id);
    expect(loaded?.ingestion?.id).toBe(ingestion.id);

    // Attempt can now reference the instance.
    const attempt = await prisma.questionAttempt.create({
      data: {
        studentId: student.id,
        questionId: question.id,
        instanceId: instance.id,
        answer: '7',
        isCorrect: true,
        timeSpentSeconds: 12,
      },
    });
    expect(attempt.instanceId).toBe(instance.id);

    const attemptsByInstance = await prisma.questionAttempt.findMany({
      where: { instanceId: instance.id },
    });
    expect(attemptsByInstance).toHaveLength(1);
  });

  // ------------------------------------------------------- Test 6

  it('Test 6: CurriculumCandidate relation works and targets the curriculum chain', async () => {
    const question = await createQuestion();

    // Build a self-contained curriculum chain (the test DB is not seeded).
    const { learningOutcome, processComponent } = await createCurriculumChain();

    const loCandidate = await prisma.curriculumCandidate.create({
      data: {
        questionId: question.id,
        level: 'LEARNING_OUTCOME',
        targetId: learningOutcome.id,
        confidence: 0.82,
        decision: 'PRIMARY',
        method: 'AI_ANCHORED',
        rationale: 'Question task matches the outcome statement.',
      },
    });

    const pcCandidate = await prisma.curriculumCandidate.create({
      data: {
        questionId: question.id,
        level: 'PROCESS_COMPONENT',
        targetId: processComponent.id,
        confidence: 0.7,
        decision: 'SECONDARY',
        method: 'AI_ANCHORED',
      },
    });

    expect(loCandidate.decision).toBe('PRIMARY');
    expect(pcCandidate.decision).toBe('SECONDARY');

    const byQuestion = await prisma.curriculumCandidate.findMany({
      where: { questionId: question.id },
    });
    expect(byQuestion).toHaveLength(2);

    // Multiple candidates for one question are expected and permitted.
    const primary = byQuestion.filter((c) => c.decision === 'PRIMARY');
    expect(primary).toHaveLength(1);
  });

  // ------------------------------------------------------- Test 7

  it('Test 7: duplicate constraints are enforced', async () => {
    // QuestionSource.code unique
    await prisma.questionSource.create({
      data: { code: 'DUP-SOURCE', name: 'A', origin: 'MEB', trustCeiling: 'HUMAN_APPROVED' },
    });
    await expect(
      prisma.questionSource.create({
        data: { code: 'DUP-SOURCE', name: 'B', origin: 'MEB', trustCeiling: 'HUMAN_APPROVED' },
      })
    ).rejects.toThrow();

    const question = await createQuestion();

    // Question.canonicalKey unique (non-null values)
    await prisma.question.create({
      data: {
        content: 'A', type: 'MULTIPLE_CHOICE', difficulty: 1,
        skillId: 'skill-1', correctAnswer: 'A', canonicalKey: 'CK-1',
      },
    });
    await expect(
      prisma.question.create({
        data: {
          content: 'B', type: 'MULTIPLE_CHOICE', difficulty: 1,
          skillId: 'skill-1', correctAnswer: 'B', canonicalKey: 'CK-1',
        },
      })
    ).rejects.toThrow();

    // QuestionIngestion.resultingQuestionId unique: a second ingestion may not
    // claim the same canonical question.
    await prisma.questionIngestion.create({
      data: { ingestMethod: 'TEXT_PASTE', state: 'APPROVED', resultingQuestionId: question.id },
    });
    await expect(
      prisma.questionIngestion.create({
        data: { ingestMethod: 'TEXT_PASTE', state: 'APPROVED', resultingQuestionId: question.id },
      })
    ).rejects.toThrow();

    // CurriculumCandidate (questionId, level, targetId) unique
    const { learningOutcome: lo } = await createCurriculumChain();
    await prisma.curriculumCandidate.create({
      data: {
        questionId: question.id, level: 'LEARNING_OUTCOME', targetId: lo.id,
        confidence: 0.8, decision: 'PRIMARY', method: 'MANUAL',
      },
    });
    await expect(
      prisma.curriculumCandidate.create({
        data: {
          questionId: question.id, level: 'LEARNING_OUTCOME', targetId: lo.id,
          confidence: 0.6, decision: 'SECONDARY', method: 'MANUAL',
        },
      })
    ).rejects.toThrow();
  });

  // ------------------------------------------------------- Test 8

  it('Test 8: a student may create multiple QuestionInstances for the same Question', async () => {
    const student = await createStudent();
    const question = await createQuestion();

    // Same student, same question, different days.
    const first = await prisma.questionInstance.create({
      data: { questionId: question.id, studentId: student.id, assetRef: 'scan-day1.jpg', assetHash: 'hash-a' },
    });
    const second = await prisma.questionInstance.create({
      data: { questionId: question.id, studentId: student.id, assetRef: 'scan-day5.jpg', assetHash: 'hash-b' },
    });
    // Same file re-uploaded: assetHash MUST NOT be unique.
    const third = await prisma.questionInstance.create({
      data: { questionId: question.id, studentId: student.id, assetRef: 'scan-day1.jpg', assetHash: 'hash-a' },
    });

    expect(first.id).not.toBe(second.id);
    expect(second.id).not.toBe(third.id);

    const instances = await prisma.questionInstance.findMany({
      where: { questionId: question.id, studentId: student.id },
    });
    expect(instances).toHaveLength(3);

    // A second student uploading the same question is also allowed.
    const student2 = await createStudent('p5a-student2@example.com');
    await prisma.questionInstance.create({
      data: { questionId: question.id, studentId: student2.id, assetRef: 'other.jpg' },
    });
    const all = await prisma.questionInstance.findMany({ where: { questionId: question.id } });
    expect(all).toHaveLength(4);
  });

  // ------------------------------------------------------- Test 9

  it('Test 9: existing QuestionSkillMapping behaviour is unchanged', async () => {
    const question = await createQuestion();
    const { microSkill } = await createCurriculumChain();

    const mapping = await prisma.questionSkillMapping.create({
      data: {
        questionId: question.id,
        microSkillId: microSkill!.id,
        relevance: 0.9,
        isPrimary: true,
        aiConfidence: 0.8,
        mappingSource: 'MANUAL_REVIEW',
      },
    });

    expect(mapping.relevance).toBeCloseTo(0.9);
    expect(mapping.isPrimary).toBe(true);
    expect(mapping.aiConfidence).toBeCloseTo(0.8);
    expect(mapping.reviewed).toBe(false);

    // @@unique([questionId, microSkillId]) still enforced.
    await expect(
      prisma.questionSkillMapping.create({
        data: {
          questionId: question.id,
          microSkillId: microSkill.id,
          relevance: 0.5,
          isPrimary: false,
          mappingSource: 'MANUAL_REVIEW',
        },
      })
    ).rejects.toThrow();

    const mappings = await prisma.questionSkillMapping.findMany({ where: { questionId: question.id } });
    expect(mappings).toHaveLength(1);
  });

  // ------------------------------------------------------- Test 10

  it('Test 10: the existing curriculum chain remains intact', async () => {
    // The test DB is not seeded; build this suite's own chain and verify every
    // relation in CurriculumVersion -> Theme -> LearningOutcome ->
    // ProcessComponent -> MicroSkill resolves.
    const { version, theme, learningOutcome, processComponent, microSkill } =
      await createCurriculumChain();

    const loadedVersion = await prisma.curriculumVersion.findUnique({
      where: { id: version.id },
      include: { themes: true },
    });
    expect(loadedVersion).not.toBeNull();
    expect(loadedVersion!.themes.length).toBeGreaterThan(0);

    const outcomes = await prisma.learningOutcome.findMany({ where: { themeId: theme.id } });
    expect(outcomes.length).toBeGreaterThan(0);

    const components = await prisma.processComponent.findMany({
      where: { learningOutcomeId: learningOutcome.id },
    });
    expect(components.length).toBeGreaterThan(0);

    const skills = await prisma.microSkill.findMany({
      where: { processComponentId: processComponent.id },
    });
    expect(skills.length).toBeGreaterThan(0);

    // Full chain resolves.
    const skill = await prisma.microSkill.findUnique({
      where: { id: microSkill.id },
      include: {
        processComponent: {
          include: {
            learningOutcome: { include: { theme: true } }
          }
        }
      }
    });
    expect(skill?.processComponent.id).toBe(processComponent.id);
    expect(skill?.processComponent.learningOutcome.id).toBe(learningOutcome.id);
    expect(skill?.processComponent.learningOutcome.theme.id).toBe(theme.id);
  });
});
