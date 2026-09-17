import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../../domain/errors/ValidationError.js';

export interface IdempotencyRequest extends Request {
  idempotencyKey?: string;
}

// Node lowercases incoming header names, so read the lowercased form.
const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
const MAX_KEY_LENGTH = 255;
const MIN_KEY_LENGTH = 1;

export function idempotencyKeyRequired() {
  return (req: IdempotencyRequest, res: Response, next: NextFunction): void => {
    const idempotencyKey = req.headers[IDEMPOTENCY_KEY_HEADER] as string;

    if (!idempotencyKey) {
      next(new ValidationError('Idempotency-Key header is required for this operation'));
      return;
    }

    if (typeof idempotencyKey !== 'string') {
      next(new ValidationError('Idempotency-Key must be a string'));
      return;
    }

    if (idempotencyKey.length < MIN_KEY_LENGTH || idempotencyKey.length > MAX_KEY_LENGTH) {
      next(new ValidationError(
        `Idempotency-Key must be between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH} characters`
      ));
      return;
    }

    // Treat the key as opaque - no additional validation of format
    req.idempotencyKey = idempotencyKey;
    next();
  };
}

export function idempotencyKeyOptional() {
  return (req: IdempotencyRequest, res: Response, next: NextFunction): void => {
    const idempotencyKey = req.headers[IDEMPOTENCY_KEY_HEADER] as string;

    if (idempotencyKey) {
      if (typeof idempotencyKey !== 'string') {
        next(new ValidationError('Idempotency-Key must be a string'));
        return;
      }

      if (idempotencyKey.length < MIN_KEY_LENGTH || idempotencyKey.length > MAX_KEY_LENGTH) {
        next(new ValidationError(
          `Idempotency-Key must be between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH} characters`
        ));
        return;
      }

      req.idempotencyKey = idempotencyKey;
    }

    next();
  };
}