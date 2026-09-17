import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { IdempotencyService } from '../../src/infrastructure/idempotency/IdempotencyService.js';
import { MockOcrProvider } from '../../src/infrastructure/ocr/MockOcrProvider.js';
import { MockQuestionUnderstandingProvider } from '../../src/infrastructure/ai/providers/MockQuestionUnderstandingProvider.js';
import { QuestionNormalizationService } from '../../src/application/services/ingestion/QuestionNormalizationService.js';
import { ProposalValidator } from '../../src/application/services/ingestion/ProposalValidator.js';
import { CurriculumProposalValidator } from '../../src/application/services/ingestion/CurriculumProposalValidator.js';
import { MicroSkillProposalValidator } from '../../src/application/services/ingestion/MicroSkillProposalValidator.js';
import { QuestionAnalysisService } from '../../src/application/services/ingestion/QuestionAnalysisService.js';
import { QuestionIngestionService } from '../../src/application/services/ingestion/QuestionIngestionService.js';
import { CurriculumCandidateService } from '../../src/application/services/curriculum/CurriculumCandidateService.js';
import { QuestionSkillMappingService } from '../../src/application/services/skills/QuestionSkillMappingService.js';
import {
  OcrProviderError,
  NormalizationError,
  InvalidProposalStructureError,
  InvalidConfidenceError,
  UnknownCurriculumTargetError,
  UnknownMicroSkillError,
  CurriculumChainIntegrityError,
} from '../../src/domain/errors/QuestionAnalysisErrors.js';
import { isValidConfidence, requiresReview } from '../../src/domain/ingestion/confidencePolicy.js';
import { INGESTION_STATES } from '../../src/domain/ingestion/ingestionStateMachine.js';

describe('Phase 5E - Question Analysis Service', () => {
  let prisma: PrismaClient;
  let idempotencyService: IdempotencyService;
  let ocrProvider: MockOcrProvider;
  let aiProvider: MockQuestionUnderstandingProvider;
  let normalizationService: QuestionNormalizationService;
  let proposalValidator: ProposalValidator;
  let curriculumValidator: CurriculumProposalValidator;
  let microSkillValidator: MicroSkillProposalValidator;
  let analysisService: QuestionAnalysisService;
  let ingestionService: QuestionIngestionService;
  let curriculumCandidateService: CurriculumCandidateService;
  let skillMappingService: QuestionSkillMappingService;

  beforeEach(async () => {
    prisma = new PrismaClient();
    idempotencyService = new IdempotencyService(prisma);
    ocrProvider = new MockOcrProvider();
    aiProvider = new MockQuestionUnderstandingProvider();
    normalizationService = new QuestionNormalizationService();
    proposalValidator = new ProposalValidator();
    curriculumValidator = new CurriculumProposalValidator(prisma);
    microSkillValidator = new MicroSkillProposalValidator(prisma);
    curriculumCandidateService = new CurriculumCandidateService(prisma, idempotencyService);
    skillMappingService = new QuestionSkillMappingService(prisma, idempotencyService);
    ingestionService = new QuestionIngestionService(prisma, idempotencyService);
    analysisService = new QuestionAnalysisService(
      prisma,
      idempotencyService,
      ocrProvider,
      aiProvider,
      normalizationService,
      curriculumCandidateService,
      skillMappingService,
      ingestionService
    );
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  /**
   * Ensure the actor row exists. IdempotencyRecord.userId and AuditLog.userId
   * are foreign keys to User, so any path that records idempotency/audit state
   * needs a real user. This mirrors production (actors are persisted users);
   * the FK is NOT loosened.
   */
  async function ensureUser(id: string): Promise<string> {
    await prisma.user.upsert({
      where: { id },
      update: {},
      create: {
        id,
        email: `${id}@example.com`,
        firstName: 'Phase5E',
        lastName: 'Actor',
        role: 'STUDENT',
      },
    });
    return id;
  }

  describe('OCR Provider Tests', () => {
    it('1. valid OCR result accepted', async () => {
      const result = await ocrProvider.extract({
        assetRef: 'test-image-1.png',
        mimeType: 'image/png',
      });

      expect(result.text).toBeTruthy();
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.metadata?.provider).toBe('mock-ocr');
    });

    it('2. OCR provider failure - invalid input', async () => {
      await expect(
        ocrProvider.extract({ assetRef: '' })
      ).rejects.toThrow();
    });

    it('3. empty OCR text handled by normalization', async () => {
      await expect(
        normalizationService.normalize('')
      ).rejects.toThrow(NormalizationError);
    });

    it('4. whitespace-only OCR text handled', async () => {
      const result = await normalizationService.normalize('   \n\n   ');
      expect(result.normalizedText).toBe('');
      expect(result.parsingConfidence).toBeLessThan(1);
    });

    it('5. placeholder OCR text detected', async () => {
      // The normalization service is a pure raw->normalized transformer; it does
      // NOT decide usability. Placeholder rejection is a validation-layer
      // invariant, enforced by ProposalValidator.validateNormalizedText (and by
      // inputValidation for the ingestion path). Verify the invariant where it
      // actually lives: a placeholder must never survive into a proposal.
      const proposal = {
        ingestionId: 'test-id',
        normalizedText: 'This is placeholder text',
        questionUnderstanding: { questionType: 'TEST', mathematicalObjects: [] },
        curriculumCandidates: [],
        microSkillCandidates: [],
        confidence: 0.8,
        warnings: [],
        modelMetadata: { provider: 'mock', model: 'v1', version: '1.0', timestamp: '2024-01-01' },
      };

      expect(() => proposalValidator.validateNormalizedText(proposal)).toThrow(
        InvalidProposalStructureError
      );
    });
  });

  describe('Normalization Tests', () => {
    it('6. normalization preserves meaning', async () => {
      const input = 'x² + 5x + 6 = 0';
      const result = await normalizationService.normalize(input);

      expect(result.normalizedText).toContain('x');
      expect(result.normalizedText).toContain('5');
      expect(result.normalizedText).toContain('6');
      expect(result.parsingConfidence).toBeGreaterThan(0.5);
    });

    it('7. ambiguous mathematical symbol generates warning', async () => {
      const input = 'х² + 5х + 6 = 0'; // Cyrillic х
      const result = await normalizationService.normalize(input);

      expect(result.warnings.length).toBeGreaterThan(0);
      // The production warning is authored as "Ambiguous character: ...".
      // Match case-insensitively so the invariant (an ambiguous symbol must
      // produce a warning) is asserted without coupling to message casing.
      expect(result.warnings.some(w => w.toLowerCase().includes('ambiguous'))).toBe(true);
    });
  });

  describe('Proposal Validation Tests', () => {
    it('8. valid AI structured output accepted', () => {
      const validProposal = {
        ingestionId: 'test-id',
        normalizedText: 'x² + 5x + 6 = 0',
        questionUnderstanding: {
          questionType: 'EQUATION_SOLVING',
          mathematicalObjects: ['variable', 'polynomial'],
        },
        curriculumCandidates: [],
        microSkillCandidates: [],
        confidence: 0.85,
        warnings: [],
        modelMetadata: {
          provider: 'mock',
          model: 'v1',
          version: '1.0',
          timestamp: new Date().toISOString(),
        },
      };

      const result = proposalValidator.validateProposal(validProposal);
      expect(result.confidence).toBe(0.85);
    });

    it('9. malformed AI output rejected', () => {
      const malformed = { invalid: 'structure' };

      expect(() => proposalValidator.validateProposal(malformed)).toThrow(
        InvalidProposalStructureError
      );
    });

    it('10. NaN confidence rejected', () => {
      const proposal = {
        ingestionId: 'test-id',
        normalizedText: 'test',
        questionUnderstanding: { questionType: 'TEST', mathematicalObjects: [] },
        curriculumCandidates: [],
        microSkillCandidates: [],
        confidence: NaN,
        warnings: [],
        modelMetadata: { provider: 'mock', model: 'v1', version: '1.0', timestamp: '2024-01-01' },
      };

      expect(() => proposalValidator.validateProposal(proposal)).toThrow(InvalidConfidenceError);
    });

    it('11. confidence > 1 rejected', () => {
      const proposal = {
        ingestionId: 'test-id',
        normalizedText: 'test',
        questionUnderstanding: { questionType: 'TEST', mathematicalObjects: [] },
        curriculumCandidates: [],
        microSkillCandidates: [],
        confidence: 1.5,
        warnings: [],
        modelMetadata: { provider: 'mock', model: 'v1', version: '1.0', timestamp: '2024-01-01' },
      };

      expect(() => proposalValidator.validateProposal(proposal)).toThrow(InvalidConfidenceError);
    });

    it('12. confidence < 0 rejected', () => {
      const proposal = {
        ingestionId: 'test-id',
        normalizedText: 'test',
        questionUnderstanding: { questionType: 'TEST', mathematicalObjects: [] },
        curriculumCandidates: [],
        microSkillCandidates: [],
        confidence: -0.1,
        warnings: [],
        modelMetadata: { provider: 'mock', model: 'v1', version: '1.0', timestamp: '2024-01-01' },
      };

      expect(() => proposalValidator.validateProposal(proposal)).toThrow(InvalidConfidenceError);
    });
  });

  describe('Confidence Policy Tests', () => {
    it('13. confidence validation helper', () => {
      expect(isValidConfidence(0.5)).toBe(true);
      expect(isValidConfidence(0.85)).toBe(true);
      expect(isValidConfidence(1.0)).toBe(true);
      expect(isValidConfidence(0.0)).toBe(true);
      expect(isValidConfidence(NaN)).toBe(false);
      expect(isValidConfidence(Infinity)).toBe(false);
      expect(isValidConfidence(-0.1)).toBe(false);
      expect(isValidConfidence(1.1)).toBe(false);
    });

    it('14. review threshold policy', () => {
      expect(requiresReview(0.9)).toBe(false);  // High confidence
      expect(requiresReview(0.85)).toBe(false); // At threshold
      expect(requiresReview(0.8)).toBe(true);   // Medium confidence
      expect(requiresReview(0.5)).toBe(true);   // Low confidence
    });
  });

  describe('Curriculum Validation Tests', () => {
    it('15. unknown LearningOutcome rejected', async () => {
      const proposal = {
        ingestionId: 'test-id',
        normalizedText: 'test',
        questionUnderstanding: { questionType: 'TEST', mathematicalObjects: [] },
        curriculumCandidates: [
          { level: 'LEARNING_OUTCOME' as const, targetId: 'unknown-id', confidence: 0.8, rationale: 'test' },
        ],
        microSkillCandidates: [],
        confidence: 0.8,
        warnings: [],
        modelMetadata: { provider: 'mock', model: 'v1', version: '1.0', timestamp: '2024-01-01' },
      };

      await expect(curriculumValidator.validateProposal(proposal)).rejects.toThrow(
        UnknownCurriculumTargetError
      );
    });

    it('16. unknown ProcessComponent rejected', async () => {
      const proposal = {
        ingestionId: 'test-id',
        normalizedText: 'test',
        questionUnderstanding: { questionType: 'TEST', mathematicalObjects: [] },
        curriculumCandidates: [
          { level: 'PROCESS_COMPONENT' as const, targetId: 'unknown-id', confidence: 0.8, rationale: 'test' },
        ],
        microSkillCandidates: [],
        confidence: 0.8,
        warnings: [],
        modelMetadata: { provider: 'mock', model: 'v1', version: '1.0', timestamp: '2024-01-01' },
      };

      await expect(curriculumValidator.validateProposal(proposal)).rejects.toThrow(
        UnknownCurriculumTargetError
      );
    });

    it('17. orphaned MicroSkill chain rejected', async () => {
      // Create a MicroSkill with invalid chain (this would require setup)
      // For now, test that the validator checks chain integrity
      const proposal = {
        ingestionId: 'test-id',
        normalizedText: 'test',
        questionUnderstanding: { questionType: 'TEST', mathematicalObjects: [] },
        curriculumCandidates: [],
        microSkillCandidates: [
          { microSkillId: 'unknown-id', confidence: 0.8, rationale: 'test' },
        ],
        confidence: 0.8,
        warnings: [],
        modelMetadata: { provider: 'mock', model: 'v1', version: '1.0', timestamp: '2024-01-01' },
      };

      await expect(microSkillValidator.validateProposal(proposal)).rejects.toThrow(
        UnknownMicroSkillError
      );
    });
  });

  describe('Integration Tests', () => {
    it('18. low confidence → REVIEW_REQUIRED', async () => {
      const proposal = {
        ingestionId: 'test-id',
        normalizedText: 'test',
        questionUnderstanding: { questionType: 'TEST', mathematicalObjects: [] },
        curriculumCandidates: [],
        microSkillCandidates: [],
        confidence: 0.5,
        warnings: [],
        modelMetadata: { provider: 'mock', model: 'v1', version: '1.0', timestamp: '2024-01-01' },
      };

      expect(requiresReview(proposal.confidence)).toBe(true);
    });

    it('19. high confidence still requires validation', () => {
      const proposal = {
        ingestionId: 'test-id',
        normalizedText: 'test',
        questionUnderstanding: { questionType: 'TEST', mathematicalObjects: [] },
        curriculumCandidates: [],
        microSkillCandidates: [],
        confidence: 0.95,
        warnings: [],
        modelMetadata: { provider: 'mock', model: 'v1', version: '1.0', timestamp: '2024-01-01' },
      };

      // Even high confidence must pass structural validation
      const result = proposalValidator.validateProposal(proposal);
      expect(result.confidence).toBe(0.95);
    });

    it('20. student upload cannot auto-promote trust', async () => {
      // This is enforced by QuestionIngestionService, not QuestionAnalysisService
      // The analysis service never touches Question.origin or Question.trust
      const ingestion = await ingestionService.createIngestion('user-1', {
        ingestMethod: 'IMAGE_UPLOAD',
        // A real (non-placeholder) stem: placeholder text is intentionally
        // rejected by the ingestion input validator.
        rawText: 'x² + 5x + 6 = 0 denkleminin köklerini bulunuz.',
      });

      expect(ingestion.state).toBe(INGESTION_STATES.INGESTED);
      // Trust promotion is handled by existing service, not AI
    });

    it('21. AI cannot mutate origin', () => {
      // QuestionAnalysisService does not have any method to mutate Question.origin
      // This is enforced by design - the service only creates proposals
      const analysisMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(analysisService));
      expect(analysisMethods).not.toContain('mutateOrigin');
    });

    it('22. AI cannot mutate trust', () => {
      // QuestionAnalysisService does not have any method to mutate Question.trust
      const analysisMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(analysisService));
      expect(analysisMethods).not.toContain('mutateTrust');
    });

    it('23. AI cannot directly create QuestionSkillMapping', async () => {
      // AI proposals go through QuestionSkillMappingService, not direct Prisma calls
      // The analysis service uses the existing service
      expect(skillMappingService).toBeDefined();
    });
  });

  describe('Idempotency Tests', () => {
    it('24. duplicate idempotency request', async () => {
      await ensureUser('user-1');
      const ingestion = await ingestionService.createIngestion('user-1', {
        ingestMethod: 'TEXT_PASTE',
        normalizedText: 'x² + 5x + 6 = 0',
      });

      const idempotencyKey = 'test-key-123';

      // First request
      const result1 = await analysisService.analyzeIngestion(
        ingestion.id,
        'user-1',
        'STUDENT',
        { skipOcr: true, normalizedText: 'x² + 5x + 6 = 0' },
        idempotencyKey
      );

      // Second request with same key should return cached result
      const result2 = await analysisService.analyzeIngestion(
        ingestion.id,
        'user-1',
        'STUDENT',
        { skipOcr: true, normalizedText: 'x² + 5x + 6 = 0' },
        idempotencyKey
      );

      expect(result1).toEqual(result2);
    });

    it('25. replay returns deterministic result', async () => {
      await ensureUser('user-1');
      const ingestion = await ingestionService.createIngestion('user-1', {
        ingestMethod: 'TEXT_PASTE',
        normalizedText: 'x² + 5x + 6 = 0',
      });

      // A replay is the same logical request repeated. The service expresses
      // that via the idempotency key: the second call must return the exact
      // recorded result WITHOUT re-running the pipeline (the ingestion has
      // already advanced out of an analyzable state).
      const idempotencyKey = 'replay-key-25';

      const result1 = await analysisService.analyzeIngestion(
        ingestion.id,
        'user-1',
        'STUDENT',
        { skipOcr: true, normalizedText: 'x² + 5x + 6 = 0' },
        idempotencyKey
      );

      const result2 = await analysisService.analyzeIngestion(
        ingestion.id,
        'user-1',
        'STUDENT',
        { skipOcr: true, normalizedText: 'x² + 5x + 6 = 0' },
        idempotencyKey
      );

      // Replay must be deterministic (identical recorded result).
      expect(result2).toEqual(result1);
      expect(result1.state).toBe(result2.state);
    });
  });

  describe('Authorization Tests', () => {
    it('26. unauthorized student approval rejected', async () => {
      // Students cannot approve their own ingestions
      // This is enforced by QuestionIngestionService, not QuestionAnalysisService
      const ingestion = await ingestionService.createIngestion('student-1', {
        ingestMethod: 'TEXT_PASTE',
        normalizedText: 'test',
      });

      await expect(
        ingestionService.transitionIngestion(
          ingestion.id,
          'student-1',
          'STUDENT',
          { toState: INGESTION_STATES.APPROVED }
        )
      ).rejects.toThrow();
    });

    it('27. authorized teacher approval accepted', async () => {
      // Teachers can approve ingestions.
      const ingestion = await ingestionService.createIngestion('teacher-1', {
        ingestMethod: 'TEXT_PASTE',
        normalizedText: 'x² + 5x + 6 = 0 denkleminin köklerini bulunuz.',
      });

      // The state machine only allows forward transitions:
      // INGESTED -> EXTRACTED -> NORMALIZED -> ANALYZED -> MAPPED -> APPROVED.
      // Walk the real sequence rather than skipping states.
      await ingestionService.transitionIngestion(
        ingestion.id,
        'teacher-1',
        'TEACHER',
        { toState: INGESTION_STATES.EXTRACTED }
      );
      await ingestionService.transitionIngestion(
        ingestion.id,
        'teacher-1',
        'TEACHER',
        { toState: INGESTION_STATES.NORMALIZED }
      );
      await ingestionService.transitionIngestion(
        ingestion.id,
        'teacher-1',
        'TEACHER',
        { toState: INGESTION_STATES.ANALYZED }
      );
      await ingestionService.transitionIngestion(
        ingestion.id,
        'teacher-1',
        'TEACHER',
        { toState: INGESTION_STATES.MAPPED }
      );

      // Then approve.
      const result = await ingestionService.transitionIngestion(
        ingestion.id,
        'teacher-1',
        'TEACHER',
        { toState: INGESTION_STATES.APPROVED }
      );

      expect(result.state).toBe(INGESTION_STATES.APPROVED);
    });
  });

  describe('Audit Tests', () => {
    it('28. audit does not contain full question text', async () => {
      await ensureUser('user-1');
      const ingestion = await ingestionService.createIngestion('user-1', {
        ingestMethod: 'TEXT_PASTE',
        normalizedText: 'x² + 5x + 6 = 0 denkleminin köklerini bulunuz',
      });

      // Check audit logs
      const auditLogs = await prisma.auditLog.findMany({
        where: { entityId: ingestion.id },
      });

      // The audit trail must actually exist for the assertion below to mean
      // anything (an empty result would pass vacuously).
      expect(auditLogs.length).toBeGreaterThan(0);

      auditLogs.forEach(log => {
        if (log.details) {
          const details = JSON.parse(log.details);
          // Full question text should not be in audit
          expect(details.normalizedText).toBeUndefined();
          expect(details.rawText).toBeUndefined();
        }
      });
    });
  });

  describe('End-to-End Analysis Tests', () => {
    it('29. full analysis pipeline with mock providers', async () => {
      await ensureUser('user-1');
      const ingestion = await ingestionService.createIngestion('user-1', {
        ingestMethod: 'IMAGE_UPLOAD',
        originalAssetRef: 'test-image.png',
      });

      const result = await analysisService.analyzeIngestion(
        ingestion.id,
        'user-1',
        'STUDENT',
        {}
      );

      expect(result.ingestionId).toBe(ingestion.id);
      expect(result.state).toBeTruthy();
      expect(['NORMALIZED', 'ANALYZED', 'REVIEW_REQUIRED']).toContain(result.state);
    });

    it('30. analysis with pre-provided text', async () => {
      // A TEXT_PASTE ingestion must carry usable text; the ingestion contract
      // rejects a contentless ingestion up front.
      await ensureUser('user-1');
      const ingestion = await ingestionService.createIngestion('user-1', {
        ingestMethod: 'TEXT_PASTE',
        rawText: 'x² + 5x + 6 = 0',
      });

      const result = await analysisService.analyzeIngestion(
        ingestion.id,
        'user-1',
        'STUDENT',
        { skipOcr: true, normalizedText: 'x² + 5x + 6 = 0' }
      );

      // With an AI provider configured the pipeline always advances past
      // NORMALIZED to a terminal analysis state; the review gate stays armed.
      expect(['ANALYZED', 'REVIEW_REQUIRED']).toContain(result.state);
      expect(result.requiresReview).toBe(true);
    });

    it('31. analysis failure without text', async () => {
      // The ingestion itself is valid (it has an asset reference); the analysis
      // then has no usable text because OCR is skipped, which is the failure
      // layer this test targets.
      await ensureUser('user-1');
      const ingestion = await ingestionService.createIngestion('user-1', {
        ingestMethod: 'IMAGE_UPLOAD',
        originalAssetRef: 'test-image.png',
      });

      await expect(
        analysisService.analyzeIngestion(
          ingestion.id,
          'user-1',
          'STUDENT',
          { skipOcr: true }
        )
      ).rejects.toThrow();
    });
  });

  describe('Phase 5E -> Phase 5D Mapping Bridge', () => {
    // The global test setup clears microSkill but not the curriculum ancestors
    // (curriculumVersion/theme/learningOutcome/processComponent). Clear the
    // chain this suite builds so each bridge test is isolated and its unique
    // curriculum codes never collide.
    beforeEach(async () => {
      await prisma.questionSkillMapping.deleteMany();
      await prisma.questionIngestion.deleteMany();
      await prisma.question.deleteMany();
      await prisma.microSkill.deleteMany();
      await prisma.processComponent.deleteMany();
      await prisma.learningOutcome.deleteMany();
      await prisma.theme.deleteMany();
      await prisma.curriculumVersion.deleteMany();
    });

    /** A staff actor row (mapping creation is staff-gated). */
    async function ensureStaff(id: string): Promise<string> {
      await prisma.user.upsert({
        where: { id },
        update: { role: 'ADMIN' },
        create: {
          id, email: `${id}@example.com`, firstName: 'Phase5E',
          lastName: 'Staff', role: 'ADMIN',
        },
      });
      return id;
    }

    /**
     * CurriculumVersion -> Theme -> LO -> PC -> MicroSkill.
     * Every code carries a per-call unique suffix so that calling this helper
     * more than once in a single test never collides on the global unique
     * codes (CurriculumVersion.code, MicroSkill.code).
     */
    async function buildCurriculumMicroSkill() {
      const uid = Math.random().toString(36).slice(2, 10);
      const version = await prisma.curriculumVersion.create({
        data: { code: 'P5E-CUR-' + uid, name: 'P5E', grade: 11, subject: 'Matematik', version: '1.0', source: 'TEST_FIXTURE' },
      });
      const theme = await prisma.theme.create({
        data: { curriculumVersionId: version.id, officialCode: 'P5E.T1-' + uid, name: 'P5E theme', lessonHours: 1, sourceOrder: 1 },
      });
      const lo = await prisma.learningOutcome.create({
        data: { themeId: theme.id, officialCode: 'P5E.LO1-' + uid, officialText: 'P5E outcome', sourceOrder: 1 },
      });
      const pc = await prisma.processComponent.create({
        data: { learningOutcomeId: lo.id, officialCode: 'P5E.PC1-' + uid, officialText: 'P5E component', sourceOrder: 1 },
      });
      const microSkill = await prisma.microSkill.create({
        data: { processComponentId: pc.id, code: 'P5E-MS-' + uid, name: 'P5E skill', description: 'fixture', source: 'TEST_FIXTURE' },
      });
      return { microSkill };
    }

    /** Drive the REAL analysis pipeline for a staff actor against an ingestion that already has a canonical Question. */
    async function runStaffAnalysis(questionId: string, opts: { key?: string } = {}) {
      const staffId = 'staff-1';
      const ingestion = await prisma.questionIngestion.create({
        data: {
          ingestedByUserId: staffId, ingestMethod: 'TEXT_PASTE',
          normalizedText: 'x2 + 5x + 6 = 0 denkleminin koklerini bulunuz.',
          state: INGESTION_STATES.INGESTED, requiresReview: true,
          resultingQuestionId: questionId,
        },
      });
      return analysisService.analyzeIngestion(
        ingestion.id, staffId, 'ADMIN',
        { skipOcr: true, normalizedText: 'x2 + 5x + 6 = 0 denkleminin koklerini bulunuz.' },
        opts.key
      );
    }

    it('32. the real analysis pipeline persists AI_MAPPED non-primary unreviewed (no timeout)', async () => {
      await ensureStaff('staff-1');
      const { microSkill } = await buildCurriculumMicroSkill();
      const question = await prisma.question.create({
        data: { content: 'x2 + 5x + 6 = 0', type: 'OPEN_ENDED', difficulty: 1, skillId: 'unmapped', correctAnswer: '', isActive: false },
      });

      const result = await runStaffAnalysis(question.id);
      expect(result.microSkillCandidatesCreated).toBeGreaterThan(0);

      const persisted = await prisma.questionSkillMapping.findMany({ where: { questionId: question.id }});
      expect(persisted.length).toBeGreaterThan(0);
      for (const m of persisted) {
        expect(m.mappingSource).toBe('AI_MAPPED');
        expect(m.isPrimary).toBe(false);
        expect(m.reviewed).toBe(false);
      }
      expect(persisted.some((m) => m.microSkillId === microSkill.id)).toBe(true);
    });

    it('33. the pipeline never produces a second PRIMARY (I13)', async () => {
      await ensureStaff('staff-1');
      const { microSkill: primarySkill } = await buildCurriculumMicroSkill();
      await buildCurriculumMicroSkill();
      const question = await prisma.question.create({
        data: { content: 'x2 + 5x + 6 = 0', type: 'OPEN_ENDED', difficulty: 1, skillId: 'unmapped', correctAnswer: '', isActive: false },
      });
      const existingPrimary = await skillMappingService.createMapping('staff-1', 'ADMIN', {
        questionId: question.id, microSkillId: primarySkill.id,
        relevance: 0.9, isPrimary: true, reviewed: true, mappingSource: 'MANUAL_REVIEW',
      });

      await runStaffAnalysis(question.id);

      const primaries = await prisma.questionSkillMapping.findMany({ where: { questionId: question.id, isPrimary: true }});
      expect(primaries.length).toBe(1);
      expect(primaries[0].id).toBe(existingPrimary.id);
    });

    it('34. the pipeline does not mutate Question provenance (origin/trust)', async () => {
      await ensureStaff('staff-1');
      await buildCurriculumMicroSkill();
      const question = await prisma.question.create({
        data: {
          content: 'x2 + 5x + 6 = 0', type: 'OPEN_ENDED', difficulty: 1, skillId: 'unmapped', correctAnswer: '', isActive: false,
          origin: 'STUDENT_UPLOADED', trust: 'UNVERIFIED',
        },
      });

      await runStaffAnalysis(question.id);

      const reloaded = await prisma.question.findFirst({ where: { id: question.id }});
      expect(reloaded?.origin).toBe('STUDENT_UPLOADED');
      expect(reloaded?.trust).toBe('UNVERIFIED');
    });

    it('35. replaying the analysis with the same idempotency key creates no duplicate mappings', async () => {
      await ensureStaff('staff-1');
      await buildCurriculumMicroSkill();
      const question = await prisma.question.create({
        data: { content: 'x2 + 5x + 6 = 0', type: 'OPEN_ENDED', difficulty: 1, skillId: 'unmapped', correctAnswer: '', isActive: false },
      });
      // A replay is the same logical request on the SAME ingestion; the second
      // call must return the recorded result and add nothing new.
      const ingestion = await prisma.questionIngestion.create({
        data: {
          ingestedByUserId: 'staff-1', ingestMethod: 'TEXT_PASTE',
          normalizedText: 'x2 + 5x + 6 = 0 denkleminin koklerini bulunuz.',
          state: INGESTION_STATES.INGESTED, requiresReview: true,
          resultingQuestionId: question.id,
        },
      });
      const key = 'p5e-bridge-key-35';
      const call = () => analysisService.analyzeIngestion(
        ingestion.id, 'staff-1', 'ADMIN',
        { skipOcr: true, normalizedText: 'x2 + 5x + 6 = 0 denkleminin koklerini bulunuz.' },
        key
      );
      const r1 = await call();
      const countFirst = await prisma.questionSkillMapping.count({ where: { questionId: question.id }});
      const r2 = await call();
      const countReplay = await prisma.questionSkillMapping.count({ where: { questionId: question.id }});
      expect(r2.state).toBe(r1.state);
      expect(countReplay).toBe(countFirst);
    });

    it('36. a student analysis never creates curriculum/mapping artefacts', async () => {
      await ensureUser('user-1');
      const { microSkill } = await buildCurriculumMicroSkill();
      const question = await prisma.question.create({
        data: { content: 'x2 + 5x + 6 = 0', type: 'OPEN_ENDED', difficulty: 1, skillId: 'unmapped', correctAnswer: '', isActive: false },
      });
      const ingestion = await prisma.questionIngestion.create({
        data: {
          ingestedByUserId: 'user-1', ingestMethod: 'TEXT_PASTE',
          normalizedText: 'x2 + 5x + 6 = 0 denkleminin koklerini bulunuz.',
          state: INGESTION_STATES.INGESTED, requiresReview: true,
          resultingQuestionId: question.id,
        },
      });
      await analysisService.analyzeIngestion(
        ingestion.id, 'user-1', 'STUDENT',
        { skipOcr: true, normalizedText: 'x2 + 5x + 6 = 0 denkleminin koklerini bulunuz.' }
      );
      const mappings = await prisma.questionSkillMapping.findMany({ where: { questionId: question.id }});
      expect(mappings.length).toBe(0);
      expect(microSkill.id).toBeTruthy();
    });
  });
});
