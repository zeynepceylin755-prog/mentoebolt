import { PrismaClient, User as PrismaUser } from '@prisma/client';
import { User } from '../../domain/entities/User.js';
import { IUserRepository } from '../../domain/interfaces/IUserRepository.js';

export class PrismaUserRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(user: User): Promise<User> {
    const data = {
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    const saved = await this.prisma.user.upsert({
      where: { id: user.id },
      update: data,
      create: data,
    });

    return this.toDomain(saved);
  }

  async findById(id: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { id, deletedAt: null },
    });
    return user ? this.toDomain(user) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { email, deletedAt: null },
    });
    return user ? this.toDomain(user) : null;
  }

  async findAll(limit: number, offset: number): Promise<User[]> {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null },
      take: limit,
      skip: offset,
    });
    return users.map(u => this.toDomain(u));
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
    const updated = await this.prisma.user.update({
      where: { id },
      data,
    });
    return this.toDomain(updated);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private toDomain(prismaUser: PrismaUser): User {
    return User.create({
      id: prismaUser.id,
      email: prismaUser.email,
      passwordHash: prismaUser.passwordHash || undefined,
      firstName: prismaUser.firstName,
      lastName: prismaUser.lastName,
      role: prismaUser.role as 'STUDENT' | 'TEACHER' | 'ADMIN' | 'CONTENT_MANAGER',
      emailVerified: prismaUser.emailVerified,
      createdAt: prismaUser.createdAt,
      updatedAt: prismaUser.updatedAt,
    });
  }
}
