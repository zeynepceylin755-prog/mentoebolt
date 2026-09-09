import { PrismaClient, Prisma } from '@prisma/client';
import { createHash } from 'crypto';

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

    // Execute entire operation in a single transaction for atomic consistency
    return this.prisma.$transaction(async (tx) => {
      // Attempt atomic claim with unique constraint violation handling
      let idempotencyRecord;
      try {
        // Try to create the idempotency record atomically
        idempotencyRecord = await tx.idempotencyRecord.create({
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
        // Check if this is a unique constraint violation
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          // Another request already claimed this key - fetch the existing record
          idempotencyRecord = await tx.idempotencyRecord.findUnique({
            where: {
              userId_operation_key: {
                userId,
                operation,
                key,
              },
            },
          });

          if (!idempotencyRecord) {
            throw new Error('Idempotency record disappeared after unique constraint violation');
          }

          // Handle existing record based on its state
          if (idempotencyRecord.requestHash !== requestHash) {
            throw new Error('Idempotency conflict: different request payload for same key');
          }

          if (idempotencyRecord.status === 'PROCESSING') {
            throw new Error('Operation already in progress');
          }

          if (idempotencyRecord.status === 'COMPLETED') {
            return JSON.parse(idempotencyRecord.response as string) as T;
          }

          // If FAILED, allow retry by updating to PROCESSING
          if (idempotencyRecord.status === 'FAILED') {
            idempotencyRecord = await tx.idempotencyRecord.update({
              where: { id: idempotencyRecord.id },
              data: {
                status: 'PROCESSING',
                requestHash,
                completedAt: null,
              },
            });
          }
        } else {
          // Re-throw non-uniqueness errors
          throw error;
        }
      }

      // Execute the business operation using the same transaction context
      // This ensures business state and idempotency state share atomic consistency
      const result = await callback(tx);

      // Store successful result in the same transaction
      await tx.idempotencyRecord.update({
        where: {
          userId_operation_key: {
            userId,
            operation,
            key,
          },
        },
        data: {
          status: 'COMPLETED',
          response: JSON.stringify(result),
          statusCode: 200,
          completedAt: new Date(),
        },
      });

      return result;
    });
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
