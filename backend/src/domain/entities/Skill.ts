import { DomainError } from '../errors/DomainError.js';
import { randomUUID } from 'crypto';

export interface SkillProps {
  id?: string;
  name: string;
  description: string;
  parentId?: string;
  subjectId: string;
  level: number;
  order: number;
  requiredForIds?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

export class Skill {
  public readonly id: string;
  public readonly name: string;
  public readonly description: string;
  public readonly parentId?: string;
  public readonly subjectId: string;
  public readonly level: number;
  public readonly order: number;
  public readonly requiredForIds: string[];
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  private constructor(props: SkillProps) {
    this.id = props.id || randomUUID();
    this.name = props.name;
    this.description = props.description;
    this.parentId = props.parentId;
    this.subjectId = props.subjectId;
    this.level = props.level;
    this.order = props.order;
    this.requiredForIds = props.requiredForIds || [];
    this.createdAt = props.createdAt || new Date();
    this.updatedAt = props.updatedAt || new Date();
  }

  static create(props: SkillProps): Skill {
    if (!props.name) {
      throw new DomainError('Skill name is required');
    }
    if (!props.subjectId) {
      throw new DomainError('Subject ID is required');
    }
    if (props.level < 0) {
      throw new DomainError('Level must be non-negative');
    }
    return new Skill(props);
  }
}
