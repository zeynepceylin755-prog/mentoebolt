import { randomUUID } from 'crypto';

export interface SessionProps {
  id?: string;
  userId: string;
  token: string;
  expiresAt: Date;
  lastActivityAt?: Date;
  ipAddress?: string;
  userAgent?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Session {
  public readonly id: string;
  public readonly userId: string;
  public readonly token: string;
  public readonly expiresAt: Date;
  public readonly lastActivityAt: Date;
  public readonly ipAddress?: string;
  public readonly userAgent?: string;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  private constructor(props: SessionProps) {
    this.id = props.id || randomUUID();
    this.userId = props.userId;
    this.token = props.token;
    this.expiresAt = props.expiresAt;
    this.lastActivityAt = props.lastActivityAt || new Date();
    this.ipAddress = props.ipAddress;
    this.userAgent = props.userAgent;
    this.createdAt = props.createdAt || new Date();
    this.updatedAt = props.updatedAt || new Date();
  }

  static create(props: SessionProps): Session {
    if (!props.userId) {
      throw new Error('User ID is required');
    }
    if (!props.token) {
      throw new Error('Token is required');
    }
    if (!props.expiresAt) {
      throw new Error('Expiration date is required');
    }
    return new Session(props);
  }

  isExpired(): boolean {
    return new Date() > this.expiresAt;
  }

  isActive(): boolean {
    return !this.isExpired();
  }

  updateActivity(): Session {
    return new Session({
      ...this,
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    });
  }
}
