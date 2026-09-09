import { Request, Response, NextFunction } from 'express';
import { logger } from '../../infrastructure/logging/logger.js';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
    
    logger[logLevel]({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }, `${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  
  next();
}
