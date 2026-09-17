import { IQuestionUnderstandingProvider, QuestionUnderstandingRequest, QuestionUnderstandingResponse } from '../../../domain/interfaces/ai/IQuestionUnderstandingProvider.js';
import { QuestionUnderstandingProposal, QuestionUnderstanding, CurriculumCandidateProposal, MicroSkillCandidateProposal } from '../../../domain/ingestion/questionUnderstandingProposal.js';
import { logger } from '../../logging/logger.js';

/**
 * MockQuestionUnderstandingProvider — Phase 5E
 *
 * Deterministic mock provider for question understanding.
 * Returns structured proposals based on input text hash.
 * 
 * This provider:
 * - Does NOT require an API key
 * - Returns deterministic results for testing
 * - Simulates realistic confidence distributions
 * - Generates warnings for edge cases
 */
export class MockQuestionUnderstandingProvider implements IQuestionUnderstandingProvider {
  private readonly provider = 'mock-question-understanding';
  private readonly model = 'mock-model-v1';
  private readonly version = '1.0.0';

  getProviderName(): string {
    return this.provider;
  }

  getModelName(): string {
    return this.model;
  }

  getVersion(): string {
    return this.version;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async analyze(request: QuestionUnderstandingRequest): Promise<QuestionUnderstandingResponse> {
    const startTime = Date.now();
    
    // Simulate processing latency
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

    const hash = this.simpleHash(request.normalizedText);
    
    // Generate deterministic mock proposal
    const proposal = this.generateMockProposal(request, hash);
    const confidence = this.generateOverallConfidence(hash);
    const warnings = this.generateMockWarnings(request.normalizedText, hash);

    const processingTimeMs = Date.now() - startTime;

    logger.debug({
      ingestionId: request.ingestionId,
      textLength: request.normalizedText.length,
      confidence,
      warningsCount: warnings.length,
      processingTimeMs,
    }, 'Mock question understanding analysis');

    return {
      proposal,
      confidence,
      warnings,
    };
  }

  private generateMockProposal(
    request: QuestionUnderstandingRequest,
    hash: number
  ): QuestionUnderstandingProposal {
    const questionUnderstanding = this.generateQuestionUnderstanding(request.normalizedText, hash);
    const curriculumCandidates = this.generateCurriculumCandidates(request, hash);
    const microSkillCandidates = this.generateMicroSkillCandidates(request, hash);

    return {
      ingestionId: request.ingestionId,
      normalizedText: request.normalizedText,
      questionUnderstanding,
      curriculumCandidates,
      microSkillCandidates,
      confidence: this.generateOverallConfidence(hash),
      warnings: this.generateMockWarnings(request.normalizedText, hash),
      modelMetadata: {
        provider: this.provider,
        model: this.model,
        version: this.version,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private generateQuestionUnderstanding(text: string, hash: number): QuestionUnderstanding {
    const questionTypes = ['EQUATION_SOLVING', 'CALCULATION', 'WORD_PROBLEM', 'GEOMETRY', 'TRIGONOMETRY'];
    const typeIndex = Math.abs(hash) % questionTypes.length;

    const mathematicalObjects = this.extractMathematicalObjects(text);

    return {
      questionType: questionTypes[typeIndex],
      mathematicalObjects,
      requestedOperation: this.inferOperation(text, hash),
      constraints: [],
    };
  }

  private extractMathematicalObjects(text: string): string[] {
    const objects: string[] = [];
    
    if (text.includes('x') || text.includes('y') || text.includes('z')) {
      objects.push('variable');
    }
    if (text.includes('²') || text.includes('^2') || text.includes('³') || text.includes('^3')) {
      objects.push('polynomial');
    }
    if (text.includes('sin') || text.includes('cos') || text.includes('tan')) {
      objects.push('trigonometric_function');
    }
    if (text.includes('log') || text.includes('ln')) {
      objects.push('logarithm');
    }
    if (text.includes('√') || text.includes('karekök')) {
      objects.push('square_root');
    }
    if (text.includes('integral') || text.includes('türev') || text.includes('derivative')) {
      objects.push('calculus');
    }

    return objects.length > 0 ? objects : ['number'];
  }

  private inferOperation(text: string, hash: number): string {
    const operations = ['SOLVE', 'CALCULATE', 'SIMPLIFY', 'EVALUATE', 'PROVE'];
    const index = Math.abs(hash) % operations.length;
    return operations[index];
  }

  private generateCurriculumCandidates(
    request: QuestionUnderstandingRequest,
    hash: number
  ): CurriculumCandidateProposal[] {
    const candidates: CurriculumCandidateProposal[] = [];

    // If curriculum context is provided, use real IDs
    if (request.curriculumContext) {
      const { learningOutcomes, processComponents } = request.curriculumContext;
      
      // Select 1-2 candidates based on hash
      const loCount = (Math.abs(hash) % 2) + 1;
      for (let i = 0; i < loCount && i < learningOutcomes.length; i++) {
        const index = (Math.abs(hash) + i) % learningOutcomes.length;
        candidates.push({
          level: 'LEARNING_OUTCOME',
          targetId: learningOutcomes[index].id,
          confidence: 0.7 + (Math.abs(hash) % 20) / 100,
          rationale: `Question matches learning outcome ${learningOutcomes[index].code}`,
        });
      }

      const pcCount = (Math.abs(hash) % 2) + 1;
      for (let i = 0; i < pcCount && i < processComponents.length; i++) {
        const index = (Math.abs(hash) + i + 10) % processComponents.length;
        candidates.push({
          level: 'PROCESS_COMPONENT',
          targetId: processComponents[index].id,
          confidence: 0.65 + (Math.abs(hash) % 25) / 100,
          rationale: `Question relates to process component ${processComponents[index].code}`,
        });
      }
    } else {
      // Fallback: generate placeholder IDs (will fail validation, as intended)
      candidates.push({
        level: 'LEARNING_OUTCOME',
        targetId: 'placeholder-lo-id',
        confidence: 0.5,
        rationale: 'No curriculum context provided',
      });
    }

    return candidates;
  }

  private generateMicroSkillCandidates(
    request: QuestionUnderstandingRequest,
    hash: number
  ): MicroSkillCandidateProposal[] {
    const candidates: MicroSkillCandidateProposal[] = [];

    // If curriculum context is provided, use real IDs
    if (request.curriculumContext?.microSkills) {
      const { microSkills } = request.curriculumContext;
      
      // Select 1-3 candidates based on hash
      const count = (Math.abs(hash) % 3) + 1;
      for (let i = 0; i < count && i < microSkills.length; i++) {
        const index = (Math.abs(hash) + i) % microSkills.length;
        candidates.push({
          microSkillId: microSkills[index].id,
          confidence: 0.6 + (Math.abs(hash) % 30) / 100,
          rationale: `Question requires microskill ${microSkills[index].code}`,
        });
      }
    } else {
      // Fallback: generate placeholder IDs (will fail validation, as intended)
      candidates.push({
        microSkillId: 'placeholder-ms-id',
        confidence: 0.4,
        rationale: 'No curriculum context provided',
      });
    }

    return candidates;
  }

  private generateOverallConfidence(hash: number): number {
    // Map hash to 0.5-0.95 range
    const normalized = (Math.abs(hash) % 450) / 1000;
    return 0.5 + normalized;
  }

  private generateMockWarnings(text: string, hash: number): string[] {
    const warnings: string[] = [];

    // 15% of analyses have ambiguous content warning
    if (hash % 7 === 0) {
      warnings.push('Question content contains ambiguous mathematical notation');
    }

    // 10% have low confidence warning
    if (hash % 10 === 0) {
      warnings.push('Low confidence in curriculum mapping');
    }

    // 5% have multiple plausible interpretations
    if (hash % 20 === 0) {
      warnings.push('Multiple plausible curriculum interpretations detected');
    }

    return warnings;
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }
}
