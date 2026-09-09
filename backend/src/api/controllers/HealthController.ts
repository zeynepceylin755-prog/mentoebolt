import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

export class HealthController {
  constructor(private readonly prisma: PrismaClient) {}

  health = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: {
          database: 'connected',
        },
      });
    } catch (error) {
      res.status(503).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        services: {
          database: 'disconnected',
        },
      });
    }
  };

  readiness = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      res.json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        services: {
          database: 'connected',
        },
      });
    } catch (error) {
      res.status(503).json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        error: 'Database connection failed',
      });
    }
  };

  liveness = async (req: Request, res: Response): Promise<void> => {
    res.json({
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  };

  metrics = async (req: Request, res: Response): Promise<void> => {
    res.set('Content-Type', 'text/plain');
    res.send(`
# HELP mentora_health Health metrics
# TYPE mentora_health gauge
mentora_uptime ${process.uptime()}
    `.trim());
  };
}
