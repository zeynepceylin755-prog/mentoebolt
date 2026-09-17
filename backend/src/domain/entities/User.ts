import { DomainError } from '../errors/DomainError.js';
import { randomUUID } from 'crypto';

export interface UserProps {
  id?: string;
  email: string;
  passwordHash?: string;
  firstName: string;
  lastName: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN' | 'CONTENT_MANAGER';
  emailVerified: boolean;
  loginAttempts?: number;
  lockedUntil?: Date;
  deletedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export class User {
  public readonly id: string;
  public readonly email: string;
  public readonly passwordHash?: string;
  public readonly firstName: string;
  public readonly lastName: string;
  public readonly role: 'STUDENT' | 'TEACHER' | 'ADMIN' | 'CONTENT_MANAGER';
  public readonly emailVerified: boolean;
  public readonly loginAttempts: number;
  public readonly lockedUntil?: Date;
  public readonly deletedAt?: Date;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  private constructor(props: UserProps) {
    this.id = props.id || randomUUID();
    this.email = props.email;
    this.passwordHash = props.passwordHash;
    this.firstName = props.firstName;
    this.lastName = props.lastName;
    this.role = props.role;
    this.emailVerified = props.emailVerified;
    this.loginAttempts = props.loginAttempts || 0;
    this.lockedUntil = props.lockedUntil;
    this.deletedAt = props.deletedAt;
    this.createdAt = props.createdAt || new Date();
    this.updatedAt = props.updatedAt || new Date();
  }

  static create(props: UserProps): User {
    if (!props.email) throw new DomainError('Email is required');
    if (!props.firstName) throw new DomainError('First name is required');
    if (!props.lastName) throw new DomainError('Last name is required');
    const validRoles = ['STUDENT', 'TEACHER', 'ADMIN', 'CONTENT_MANAGER'];
    if (!validRoles.includes(props.role)) throw new DomainError('Invalid role');
    return new User(props);
  }

  get fullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }
}
