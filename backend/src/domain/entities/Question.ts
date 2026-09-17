import { DomainError } from '../errors/DomainError.js';
import { randomUUID } from 'crypto';

// Canonical Question.type vocabulary.
// The database is the source of truth and uses UPPER_SNAKE_CASE values
// (see Prisma `model Question`, `type String @default("MULTIPLE_CHOICE")`).
// The domain entity previously used lower_snake_case, which had no conversion layer
// and therefore never matched what was actually stored. Aligned to the DB vocabulary.
export type QuestionType = 'MULTIPLE_CHOICE' | 'OPEN_ENDED' | 'CALCULATION' | 'CONCEPTUAL';

// Legacy API contract values (lower_snake_case) mapped to the canonical vocabulary.
// Kept so any existing API payload shape continues to resolve correctly.
const LEGACY_TYPE_MAP: Record<string, QuestionType> = {
  multiple_choice: 'MULTIPLE_CHOICE',
  open_ended: 'OPEN_ENDED',
  calculation: 'CALCULATION',
  conceptual: 'CONCEPTUAL',
};

export function normalizeQuestionType(value: string): QuestionType {
  if (LEGACY_TYPE_MAP[value]) {
    return LEGACY_TYPE_MAP[value];
  }
  return value as QuestionType;
}

export interface QuestionProps {
  id?: string;
  content: string;
  type: string;
  difficulty: number;
  skillId: string;
  options?: string[];
  correctAnswer: string;
  explanation?: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Question {
  public readonly id: string;
  public readonly content: string;
  public readonly type: QuestionType;
  public readonly difficulty: number;
  public readonly skillId: string;
  public readonly options?: string[];
  public readonly correctAnswer: string;
  public readonly explanation?: string;
  public readonly metadata?: Record<string, unknown>;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  private constructor(props: QuestionProps) {
    this.id = props.id || randomUUID();
    this.content = props.content;
    this.type = normalizeQuestionType(props.type);
    this.difficulty = props.difficulty;
    this.skillId = props.skillId;
    this.options = props.options;
    this.correctAnswer = props.correctAnswer;
    this.explanation = props.explanation;
    this.metadata = props.metadata;
    this.createdAt = props.createdAt || new Date();
    this.updatedAt = props.updatedAt || new Date();
  }

  static create(props: QuestionProps): Question {
    if (!props.content) {
      throw new DomainError('Question content is required');
    }
    if (!props.skillId) {
      throw new DomainError('Skill ID is required');
    }
    if (props.difficulty < 1 || props.difficulty > 10) {
      throw new DomainError('Difficulty must be between 1 and 10');
    }
    if (normalizeQuestionType(props.type) === 'MULTIPLE_CHOICE' && (!props.options || props.options.length < 2)) {
      throw new DomainError('Multiple choice questions must have at least 2 options');
    }
    if (!props.correctAnswer) {
      throw new DomainError('Correct answer is required');
    }
    return new Question(props);
  }
}
