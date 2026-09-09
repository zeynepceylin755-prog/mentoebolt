import { PrismaClient } from '@prisma/client';
import { logger } from '../logging/logger.js';

// Singleton pattern for Prisma Client with connection pooling
let prismaInstance: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log: process.env.NODE_ENV === 'development' 
        ? ['query', 'info', 'warn', 'error']
        : ['error'],
    });
    
    logger.info('Prisma Client initialized');
  }
  
  return prismaInstance;
}

export async function disconnectPrisma(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
    logger.info('Prisma Client disconnected');
  }
}
