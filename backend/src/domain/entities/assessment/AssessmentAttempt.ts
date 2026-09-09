import { randomUUID } from 'crypto';

export type AttemptStatus = 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED' | 'TIMED_OUT';

export interface AssessmentAttemptProps {
  id?: string;
  studentId: string;
  assessmentId: string;
  startedAt?: Date;
  completedAt?: Date;
  status: AttemptStatus;
  score?: number;
  maxScore?: number;
  percentageScore?: number;
  timeSpentSeconds?: number;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

export class AssessmentAttempt {
  public readonly id: string;
  public readonly studentId: string;
  public readonly assessmentId: string;
  public readonly startedAt: Date;
  private _completedAt?: Date;
  private _status: AttemptStatus;
  private _score?: number;
  private _maxScore?: number;
  private _percentageScore?: number;
  private _timeSpentSeconds?: number;
  public readonly metadata?: Record<string, unknown>;
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(props: AssessmentAttemptProps) {
    this.id = props.id || randomUUID();
    this.studentId = props.studentId;
    this.assessmentId = props.assessmentId;
    this.startedAt = props.startedAt || new Date();
    this._completedAt = props.completedAt;
    this._status = props.status;
    this._score = props.score;
    this._maxScore = props.maxScore;
    this._percentageScore = props.percentageScore;
    this._timeSpentSeconds = props.timeSpentSeconds;
    this.metadata = props.metadata;
    this.createdAt = props.createdAt || new Date();
    this.updatedAt = props.updatedAt || new Date();
  }

  static create(studentId: string, assessmentId: string): AssessmentAttempt {
    return new AssessmentAttempt({
      studentId,
      assessmentId,
      status: 'IN_PROGRESS',
    });
  }

  static reconstitute(props: AssessmentAttemptProps): AssessmentAttempt {
    return new AssessmentAttempt(props);
  }

  get status(): AttemptStatus {
    return this._status;
  }

  get completedAt(): Date | undefined {
    return this._completedAt;
  }

  get score(): number | undefined {
    return this._score;
  }

  get maxScore(): number | undefined {
    return this._maxScore;
  }

  get percentageScore(): number | undefined {
    return this._percentageScore;
  }

  get timeSpentSeconds(): number | undefined {
    return this._timeSpentSeconds;
  }

  get isInProgress(): boolean {
    return this._status === 'IN_PROGRESS';
  }

  get isCompleted(): boolean {
    return this._status === 'COMPLETED';
  }

  complete(score: number, maxScore: number, timeSpentSeconds: number): AssessmentAttempt {
    if (this.isCompleted) {
      throw new Error('Assessment already completed');
    }
    return new AssessmentAttempt({
      ...this,
      status: 'COMPLETED',
      completedAt: new Date(),
      score,
      maxScore,
      percentageScore: maxScore > 0 ? (score / maxScore) * 100 : 0,
      timeSpentSeconds,
      updatedAt: new Date(),
    });
  }

  abandon(): AssessmentAttempt {
    if (this.isCompleted) {
      throw new Error('Assessment already completed');
    }
    return new AssessmentAttempt({
      ...this,
      status: 'ABANDONED',
      completedAt: new Date(),
      updatedAt: new Date(),
    });
  }

  timeout(): AssessmentAttempt {
    if (this.isCompleted) {
      throw new Error('Assessment already completed');
    }
    return new AssessmentAttempt({
      ...this,
      status: 'TIMED_OUT',
      completedAt: new Date(),
      updatedAt: new Date(),
    });
  }

  isTimedOut(timeLimitMinutes: number): boolean {
    const elapsedMinutes = (Date.now() - this.startedAt.getTime()) / (1000 * 60);
    return elapsedMinutes > timeLimitMinutes;
  }
}
