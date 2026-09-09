import { randomUUID } from 'crypto';

export interface RefreshTokenProps {
  id?: string;
  userId: string;
  token: string;
  expiresAt: Date;
  revokedAt?: Date;
  replacedByTokenId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class RefreshToken {
  public readonly id: string;
  public readonly userId: string;
  public readonly token: string;
  public readonly expiresAt: Date;
  public readonly revokedAt?: Date;
  public readonly replacedByTokenId?: string;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;

  private constructor(props: RefreshTokenProps) {
    this.id = props.id || randomUUID();
    this.userId = props.userId;
    this.token = props.token;
    this.expiresAt = props.expiresAt;
    this.revokedAt = props.revokedAt;
    this.replacedByTokenId = props.replacedByTokenId;
    this.createdAt = props.createdAt || new Date();
    this.updatedAt = props.updatedAt || new Date();
  }

  static create(props: RefreshTokenProps): RefreshToken {
    if (!props.userId) {
      throw new Error('User ID is required');
    }
    if (!props.token) {
      throw new Error('Token is required');
    }
    if (!props.expiresAt) {
      throw new Error('Expiration date is required');
    }
    return new RefreshToken(props);
  }

  isExpired(): boolean {
    return new Date() > this.expiresAt;
  }

  isRevoked(): boolean {
    return !!this.revokedAt;
  }

  isActive(): boolean {
    return !this.isExpired() && !this.isRevoked();
  }

  revoke(replacedByTokenId?: string): RefreshToken {
    return new RefreshToken({
      ...this,
      revokedAt: new Date(),
      replacedByTokenId: replacedByTokenId,
    });
  }
}
