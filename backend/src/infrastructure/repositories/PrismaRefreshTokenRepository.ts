import { PrismaClient, RefreshToken as PrismaRefreshToken } from '@prisma/client';
import { RefreshToken } from '../../domain/entities/RefreshToken.js';
import { IRefreshTokenRepository } from '../../domain/interfaces/IRefreshTokenRepository.js';

export class PrismaRefreshTokenRepository implements IRefreshTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(token: RefreshToken): Promise<RefreshToken> {
    const data = {
      id: token.id,
      userId: token.userId,
      token: token.token,
      expiresAt: token.expiresAt,
      revokedAt: token.revokedAt,
      replacedByTokenId: token.replacedByTokenId,
      createdAt: token.createdAt,
      updatedAt: token.updatedAt,
    };

    const saved = await this.prisma.refreshToken.upsert({
      where: { id: token.id },
      update: data,
      create: data,
    });

    return this.toDomain(saved);
  }

  async findByToken(token: string): Promise<RefreshToken | null> {
    const saved = await this.prisma.refreshToken.findUnique({
      where: { token },
    });
    return saved ? this.toDomain(saved) : null;
  }

  async findByUserId(userId: string): Promise<RefreshToken[]> {
    const tokens = await this.prisma.refreshToken.findMany({
      where: { userId },
    });
    return tokens.map(t => this.toDomain(t));
  }

  async revoke(tokenId: string): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId },
      data: { revokedAt: new Date() },
    });
  }

  async deleteExpired(): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
  }

  private toDomain(prismaToken: PrismaRefreshToken): RefreshToken {
    return RefreshToken.create({
      id: prismaToken.id,
      userId: prismaToken.userId,
      token: prismaToken.token,
      expiresAt: prismaToken.expiresAt,
      revokedAt: prismaToken.revokedAt || undefined,
      replacedByTokenId: prismaToken.replacedByTokenId || undefined,
      createdAt: prismaToken.createdAt,
      updatedAt: prismaToken.updatedAt,
    });
  }
}
