import { DomainError } from '../errors/DomainError.js';
import { randomUUID } from 'crypto';

export interface QuestionAttemptProps {
  id?: string;
  studentId: string;
  questionId: string;
  answer: string;
  isCorrect: boolean;
  timeSpentSeconds: number;
  errorType?: 'concept' | 'skill' | 'prerequisite' | 'operation' | 'reading' | 'calculation' | 'other';
  sessionId?: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}

export class QuestionAttempt {
  public readonly id: string;
  public readonly studentId: string;
  public readonly questionId: string;
  public readonly answer: string;
  public readonly isCorrect: boolean;
  public readonly timeSpentSeconds: number;
  public readonly errorType?: 'concept' | 'skill' | 'prerequisite' | 'operation' | 'reading' | 'calculation' | 'other';
  public readonly sessionId?: string;
  public readonly metadata?: Record<string, unknown>;
  public readonly createdAt: Date;

  private constructor(props: QuestionAttemptProps) {
    this.id = props.id || randomUUID();
    this.studentId = props.studentId;
    this.questionId = props.questionId;
    this.answer = props.answer;
    this.isCorrect = props.isCorrect;
    this.timeSpentSeconds = props.timeSpentSeconds;
    this.errorType = props.errorType;
    this.sessionId = props.sessionId;
    this.metadata = props.metadata;
    this.createdAt = props.createdAt || new Date();
  }

  static create(props: QuestionAttemptProps): QuestionAttempt {
    if (!props.studentId) {
      throw new DomainError('Student ID is required');
    }
    if (!props.questionId) {
      throw new DomainError('Question ID is required');
    }
    if (!props.answer) {
      throw new DomainError('Answer is required');
    }
    if (props.timeSpentSeconds < 0) {
      throw new DomainError('Time spent must be non-negative');
    }
    return new QuestionAttempt(props);
  }
}
