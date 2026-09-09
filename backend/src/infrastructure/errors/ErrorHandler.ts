import { Request, Response, NextFunction } from 'express';
import { DomainError } from '../../domain/errors/DomainError.js';
import { ValidationError } from '../../domain/errors/ValidationError.js';
import { logger } from '../logging/logger.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (err instanceof DomainError) {
    if (err.shouldLog) {
      logger.error({ error: err, path: req.path }, err.message);
    } else {
      logger.debug({ error: err, path: req.path }, err.message);
    }
    
    const response: any = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    };
    
    if (err instanceof ValidationError && err.details) {
      response.error.details = err.details;
    }
    
    res.status(err.statusCode).json(response);
    return;
  }
  
  logger.error({ error: err, path: req.path, stack: err.stack }, 'Unhandled error');
  
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
