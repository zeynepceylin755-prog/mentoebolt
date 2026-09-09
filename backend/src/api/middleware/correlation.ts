import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.headers['x-request-id'] as string || randomUUID();
  const traceId = req.headers['x-trace-id'] as string || randomUUID();
  
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Trace-ID', traceId);
  
  (req as any).requestId = requestId;
  (req as any).traceId = traceId;
  
  next();
}
