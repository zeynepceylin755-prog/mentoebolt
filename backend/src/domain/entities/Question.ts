import { DomainError } from '../errors/DomainError.js';
import { randomUUID } from 'crypto';

export interface QuestionProps {
  id?: string;
  content: string;
  type: 'multiple_choice' | 'open_ended' | 'calculation' | 'conceptual';
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
  public readonly type: 'multiple_choice' | 'open_ended' | 'calculation' | 'conceptual';
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
    this.type = props.type;
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
    if (props.type === 'multiple_choice' && (!props.options || props.options.length < 2)) {
      throw new DomainError('Multiple choice questions must have at least 2 options');
    }
    if (!props.correctAnswer) {
      throw new DomainError('Correct answer is required');
    }
    return new Question(props);
  }
}
