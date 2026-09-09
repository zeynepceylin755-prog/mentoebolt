import { DomainError } from '../errors/DomainError.js';
import { randomUUID } from 'crypto';

export interface StudentProps {
  id?: string;
  userId: string;
  grade: number;
  school?: string;
  learningProfileId?: string;
  learningStage?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Student {
  public readonly id: string;
  public readonly userId: string;
  public readonly grade: number;
  public readonly school?: string;
  public readonly learningProfileId?: string;
  public readonly learningStage: string;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  private constructor(props: StudentProps) {
    this.id = props.id || randomUUID();
    this.userId = props.userId;
    this.grade = props.grade;
    this.school = props.school;
    this.learningProfileId = props.learningProfileId;
    this.learningStage = props.learningStage || 'DISCOVERY';
    this.createdAt = props.createdAt || new Date();
    this.updatedAt = props.updatedAt || new Date();
  }

  static create(props: StudentProps): Student {
    if (!props.userId) throw new DomainError('User ID is required');
    if (props.grade < 1 || props.grade > 12) throw new DomainError('Grade must be between 1 and 12');
    return new Student(props);
  }
}
