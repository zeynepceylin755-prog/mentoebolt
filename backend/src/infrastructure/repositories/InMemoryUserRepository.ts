import { User } from '../../domain/entities/User.js';
import { IUserRepository } from '../../domain/interfaces/IUserRepository.js';

export class InMemoryUserRepository implements IUserRepository {
  private users: Map<string, User> = new Map();

  async save(user: User): Promise<User> {
    this.users.set(user.id, user);
    return user;
  }

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email) {
        return user;
      }
    }
    return null;
  }

  async findAll(limit: number, offset: number): Promise<User[]> {
    const all = Array.from(this.users.values());
    return all.slice(offset, offset + limit);
  }

  async update(id: string, data: Partial<{
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
  }>): Promise<User> {
    const existing = this.users.get(id);
    if (!existing) {
      throw new Error('User not found');
    }
    
    // Create updated user with new data
    const updatedUser = User.create({
      id: existing.id,
      email: existing.email,
      passwordHash: data.passwordHash || existing.passwordHash,
      firstName: existing.firstName,
      lastName: existing.lastName,
      role: existing.role,
      emailVerified: data.emailVerified !== undefined ? data.emailVerified : existing.emailVerified,
      loginAttempts: data.loginAttempts !== undefined ? data.loginAttempts : (existing as any).loginAttempts || 0,
      lockedUntil: data.lockedUntil !== undefined ? data.lockedUntil : (existing as any).lockedUntil,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    });
    
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  async delete(id: string): Promise<void> {
    this.users.delete(id);
  }
}
