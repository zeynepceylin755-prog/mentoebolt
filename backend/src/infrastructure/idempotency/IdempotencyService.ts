import { PrismaClient, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { ConflictError } from '../../domain/errors/ConflictError.js';

export class IdempotencyService {
  constructor(private readonly prisma: PrismaClient) {}

  async execute<T>(
    userId: string,
    operation: string,
    key: string,
    requestPayload: any,
    callback: (tx: any) => Promise<T>,
    ttlSeconds: number = 86400 // 24 hours
  ): Promise<T> {
    // Generate request hash for payload comparison
    const requestHash = this.generateHash(requestPayload);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    let duplicateClaim = false;

    try {
      return await this.prisma.$transaction(async (tx) => {
        try {
          await tx.idempotencyRecord.create({
            data: {
              userId,
              operation,
              key,
              requestHash,
              status: 'PROCESSING',
              expiresAt,
            },
          });
        } catch (error) {
          if (this.isUniqueConstraintError(error)) {
            duplicateClaim = true;
          }
          throw error;
        }

        return this.executeClaimed(tx, userId, operation, key, callback);
      });
    } catch (error) {
      if (!duplicateClaim || !this.isUniqueConstraintError(error)) {
        throw error;
      }

      // PostgreSQL aborts the transaction after P2002. Resolve the duplicate
      // using a new Prisma operation, outside that aborted transaction.
      return this.resolveDuplicate(
        userId,
        operation,
        key,
        requestHash,
        callback,
        expiresAt
      );
    }
  }

  private async resolveDuplicate<T>(
    userId: string,
    operation: string,
    key: string,
    requestHash: string,
    callback: (tx: any) => Promise<T>,
    expiresAt: Date
  ): Promise<T> {
    const record = await this.prisma.idempotencyRecord.findUnique({
      where: { userId_operation_key: { userId, operation, key } },
    });

    if (!record) {
      throw new ConflictError('Idempotency record disappeared after unique constraint violation');
    }
    if (record.status === 'PROCESSING') {
      throw new ConflictError('Operation already in progress');
    }
    if (record.status === 'COMPLETED') {
      return this.replayCompleted(record, requestHash);
    }
    if (record.status === 'FAILED') {
      return this.retryFailed(record.id, userId, operation, key, requestHash, callback, expiresAt);
    }

    throw new ConflictError('Unknown idempotency record state');
  }

  private async retryFailed<T>(
    id: string,
    userId: string,
    operation: string,
    key: string,
    requestHash: string,
    callback: (tx: any) => Promise<T>,
    expiresAt: Date
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.idempotencyRecord.updateMany({
        where: { id, status: 'FAILED' },
        data: { status: 'PROCESSING', requestHash, expiresAt, completedAt: null },
      });

      if (claimed.count === 0) {
        const current = await tx.idempotencyRecord.findUnique({ where: { id } });
        if (current?.status === 'COMPLETED') {
          return this.replayCompleted(current, requestHash);
        }
        throw new ConflictError('Operation already in progress');
      }

      return this.executeClaimed(tx, userId, operation, key, callback);
    });
  }

  private async executeClaimed<T>(
    tx: any,
    userId: string,
    operation: string,
    key: string,
    callback: (tx: any) => Promise<T>
  ): Promise<T> {
    const result = await callback(tx);

    await tx.idempotencyRecord.update({
      where: { userId_operation_key: { userId, operation, key } },
      data: {
        status: 'COMPLETED',
        response: JSON.stringify(result),
        statusCode: 200,
        completedAt: new Date(),
      },
    });

    return result;
  }

  private replayCompleted<T>(
    record: { requestHash: string; response: string | null },
    requestHash: string
  ): T {
    if (record.requestHash !== requestHash) {
      throw new ConflictError('Idempotency conflict: different request payload for same key');
    }
    if (!record.response) {
      throw new ConflictError('Idempotency conflict: completed record has no stored response');
    }
    return JSON.parse(record.response) as T;
  }

  private isUniqueConstraintError(
    error: unknown
  ): error is Prisma.PrismaClientKnownRequestError {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private generateHash(payload: any): string {
    const str = JSON.stringify(payload);
    return createHash('sha256').update(str).digest('hex');
  }

  async cleanupExpired(): Promise<void> {
    const expired = await this.prisma.idempotencyRecord.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    return;
  }
}
