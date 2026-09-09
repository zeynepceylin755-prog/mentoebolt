import { PrismaClient, Session as PrismaSession } from '@prisma/client';
import { Session } from '../../domain/entities/Session.js';
import { ISessionRepository } from '../../domain/interfaces/ISessionRepository.js';

export class PrismaSessionRepository implements ISessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(session: Session): Promise<Session> {
    const data = {
      id: session.id,
      userId: session.userId,
      token: session.token,
      expiresAt: session.expiresAt,
      lastActivityAt: session.lastActivityAt,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };

    const saved = await this.prisma.session.upsert({
      where: { id: session.id },
      update: data,
      create: data,
    });

    return this.toDomain(saved);
  }

  async findByToken(token: string): Promise<Session | null> {
    const saved = await this.prisma.session.findUnique({
      where: { token },
    });
    return saved ? this.toDomain(saved) : null;
  }

  async findByUserId(userId: string): Promise<Session[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId },
    });
    return sessions.map(s => this.toDomain(s));
  }

  async delete(sessionId: string): Promise<void> {
    await this.prisma.session.delete({
      where: { id: sessionId },
    });
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { userId },
    });
  }

  async deleteExpired(): Promise<void> {
    await this.prisma.session.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
  }

  private toDomain(prismaSession: PrismaSession): Session {
    return Session.create({
      id: prismaSession.id,
      userId: prismaSession.userId,
      token: prismaSession.token,
      expiresAt: prismaSession.expiresAt,
      lastActivityAt: prismaSession.lastActivityAt,
      ipAddress: prismaSession.ipAddress || undefined,
      userAgent: prismaSession.userAgent || undefined,
      createdAt: prismaSession.createdAt,
      updatedAt: prismaSession.updatedAt,
    });
  }
}
