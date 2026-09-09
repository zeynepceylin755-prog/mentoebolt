import { User } from '../entities/User.js';

export interface IUserRepository {
  save(user: User): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findAll(limit: number, offset: number): Promise<User[]>;
  update(id: string, data: Partial<{
    passwordHash: string;
    emailVerified: boolean;
    emailVerifiedAt: Date;
    verificationToken: string | null;
    verificationTokenExpiry: Date | null;
    resetToken: string | null;
    resetTokenExpiry: Date | null;
    lastLoginAt: Date;
    loginAttempts: number;
    lockedUntil: Date | null;
  }>): Promise<User>;
  delete(id: string): Promise<void>;
}
