import { randomUUID } from 'crypto';

export type EventType = 
  | 'SESSION_STARTED'
  | 'SESSION_COMPLETED'
  | 'QUESTION_ATTEMPTED'
  | 'QUESTION_CORRECT'
  | 'QUESTION_INCORRECT'
  | 'SKILL_MASTERY_UPDATED'
  | 'ASSESSMENT_STARTED'
  | 'ASSESSMENT_COMPLETED'
  | 'REVIEW_COMPLETED'
  | 'RECOMMENDATION_ACCEPTED'
  | 'RECOMMENDATION_COMPLETED';

export interface LearningEventProps {
  id?: string;
  studentId: string;
  type: EventType;
  sessionId?: string;
  skillId?: string;
  topicId?: string;
  questionId?: string;
  assessmentId?: string;
  metadata?: Record<string, unknown>;
  timestamp?: Date;
  createdAt?: Date;
}

export class LearningEvent {
  public readonly id: string;
  public readonly studentId: string;
  public readonly type: EventType;
  public readonly sessionId?: string;
  public readonly skillId?: string;
  public readonly topicId?: string;
  public readonly questionId?: string;
  public readonly assessmentId?: string;
  public readonly metadata?: Record<string, unknown>;
  public readonly timestamp: Date;
  public readonly createdAt: Date;

  private constructor(props: LearningEventProps) {
    this.id = props.id || randomUUID();
    this.studentId = props.studentId;
    this.type = props.type;
    this.sessionId = props.sessionId;
    this.skillId = props.skillId;
    this.topicId = props.topicId;
    this.questionId = props.questionId;
    this.assessmentId = props.assessmentId;
    this.metadata = props.metadata;
    this.timestamp = props.timestamp || new Date();
    this.createdAt = props.createdAt || new Date();
  }

  static create(props: Omit<LearningEventProps, 'id' | 'createdAt'>): LearningEvent {
    return new LearningEvent(props);
  }

  static reconstitute(props: LearningEventProps): LearningEvent {
    return new LearningEvent(props);
  }
}
