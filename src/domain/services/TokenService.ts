import jwt from 'jsonwebtoken';
import { getEnv } from '../../infrastructure/config/environment.js';
import { randomBytes } from 'crypto';

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export class TokenService {
  private readonly env = getEnv();

  generateAccessToken(payload: TokenPayload): string {
    const expiresIn = this.env.JWT_EXPIRES_IN || '15m';
    return jwt.sign(payload, this.env.JWT_SECRET, { expiresIn } as jwt.SignOptions);
  }

  generateRefreshToken(userId: string, tokenId: string): string {
    const payload = { type: 'refresh', userId, tokenId };
    const expiresIn = this.env.JWT_REFRESH_EXPIRES_IN || '7d';
    return jwt.sign(payload, this.env.JWT_REFRESH_SECRET, { expiresIn } as jwt.SignOptions);
  }

  verifyAccessToken(token: string): TokenPayload {
    return jwt.verify(token, this.env.JWT_SECRET) as TokenPayload;
  }

  verifyRefreshToken(token: string): { userId: string; tokenId: string } {
    return jwt.verify(token, this.env.JWT_REFRESH_SECRET) as { userId: string; tokenId: string };
  }

  generateSecureToken(): string {
    return randomBytes(32).toString('hex');
  }

  getRefreshTokenExpiry(): number {
    const expiresIn = this.env.JWT_REFRESH_EXPIRES_IN || '7d';
    return this.parseExpiry(expiresIn);
  }

  private parseExpiry(expiry: string): number {
    const value = parseInt(expiry);
    if (!isNaN(value)) return value;
    
    if (expiry.endsWith('d')) {
      return parseInt(expiry) * 24 * 60 * 60;
    }
    if (expiry.endsWith('h')) {
      return parseInt(expiry) * 60 * 60;
    }
    if (expiry.endsWith('m')) {
      return parseInt(expiry) * 60;
    }
    if (expiry.endsWith('s')) {
      return parseInt(expiry);
    }
    return 3600; // default 1 hour
  }
}
