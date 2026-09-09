import { DomainError } from '../errors/DomainError.js';
import { randomUUID } from 'crypto';

export enum LearningSignalType {
  ERROR_PATTERN = 'error_pattern',
  SKILL_IMPROVEMENT = 'skill_improvement',
  NEW_WEAKNESS = 'new_weakness',
  MASTERY_GAINED = 'mastery_gained',
  PREREQUISITE_GAP = 'prerequisite_gap',
  VALIDATION_CONFIRMED = 'validation_confirmed',
  VALIDATION_REJECTED = 'validation_rejected',
}

export interface LearningSignalProps {
  id?: string;
  studentId: string;
  type: LearningSignalType;
  description: string;
  confidence: number;
  metadata?: Record<string, unknown>;
  validated?: boolean;
  createdAt?: Date;
}

export class LearningSignal {
  public readonly id: string;
  public readonly studentId: string;
  public readonly type: LearningSignalType;
  public readonly description: string;
  public readonly confidence: number;
  public readonly metadata?: Record<string, unknown>;
  public readonly validated: boolean;
  public readonly createdAt: Date;

  private constructor(props: LearningSignalProps) {
    this.id = props.id || randomUUID();
    this.studentId = props.studentId;
    this.type = props.type;
    this.description = props.description;
    this.confidence = props.confidence;
    this.metadata = props.metadata;
    this.validated = props.validated || false;
    this.createdAt = props.createdAt || new Date();
  }

  static create(props: LearningSignalProps): LearningSignal {
    if (!props.studentId) {
      throw new DomainError('Student ID is required');
    }
    if (!props.description) {
      throw new DomainError('Description is required');
    }
    if (props.confidence < 0 || props.confidence > 1) {
      throw new DomainError('Confidence must be between 0 and 1');
    }
    return new LearningSignal(props);
  }

  validate(): LearningSignal {
    return new LearningSignal({
      ...this,
      validated: true,
    });
  }
}
