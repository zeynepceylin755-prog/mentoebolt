import { randomUUID } from 'crypto';

export type AssessmentType = 'DIAGNOSTIC' | 'FORMATIVE' | 'SUMMATIVE' | 'PRACTICE';
export type AssessmentStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface AssessmentProps {
  id?: string;
  title: string;
  description?: string;
  type: AssessmentType;
  status: AssessmentStatus;
  skillIds: string[];
  topicIds: string[];
  totalQuestions: number;
  timeLimitMinutes?: number;
  passingScore?: number;
  isActive: boolean;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Assessment {
  public readonly id: string;
  public readonly title: string;
  public readonly description?: string;
  public readonly type: AssessmentType;
  private _status: AssessmentStatus;
  public readonly skillIds: string[];
  public readonly topicIds: string[];
  public totalQuestions: number;
  public readonly timeLimitMinutes?: number;
  public readonly passingScore?: number;
  public readonly isActive: boolean;
  public readonly metadata?: Record<string, unknown>;
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(props: AssessmentProps) {
    this.id = props.id || randomUUID();
    this.title = props.title;
    this.description = props.description;
    this.type = props.type;
    this._status = props.status;
    this.skillIds = props.skillIds || [];
    this.topicIds = props.topicIds || [];
    this.totalQuestions = props.totalQuestions || 0;
    this.timeLimitMinutes = props.timeLimitMinutes;
    this.passingScore = props.passingScore;
    this.isActive = props.isActive !== undefined ? props.isActive : true;
    this.metadata = props.metadata;
    this.createdAt = props.createdAt || new Date();
    this.updatedAt = props.updatedAt || new Date();
  }

  static create(props: Omit<AssessmentProps, 'status' | 'isActive'>): Assessment {
    return new Assessment({
      ...props,
      status: 'DRAFT',
      isActive: true,
      totalQuestions: 0,
    });
  }

  static reconstitute(props: AssessmentProps): Assessment {
    return new Assessment(props);
  }

  get status(): AssessmentStatus {
    return this._status;
  }

  publish(): Assessment {
    if (this._status === 'PUBLISHED') {
      throw new Error('Assessment is already published');
    }
    if (this.totalQuestions === 0) {
      throw new Error('Cannot publish assessment with no questions');
    }
    return new Assessment({
      ...this,
      status: 'PUBLISHED',
      updatedAt: new Date(),
    });
  }

  archive(): Assessment {
    return new Assessment({
      ...this,
      status: 'ARCHIVED',
      updatedAt: new Date(),
    });
  }

  addQuestion(): Assessment {
    return new Assessment({
      ...this,
      totalQuestions: this.totalQuestions + 1,
      updatedAt: new Date(),
    });
  }
}
