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

  // Malformed JSON body: express.json() surfaces a SyntaxError with a
  // `status`/`type` describing a bad request. Return 400, not 500.
  const anyErr = err as any;
  if (anyErr?.type === 'entity.parse.failed' || anyErr?.status === 400) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Malformed request body',
      },
    });
    return;
  }

  // Payload too large
  if (anyErr?.type === 'entity.too.large' || anyErr?.status === 413) {
    res.status(413).json({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large',
      },
    });
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
