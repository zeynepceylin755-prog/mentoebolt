import { DomainError } from './DomainError.js';

export class ValidationError extends DomainError {
  constructor(
    message: string,
    public readonly details?: Record<string, string[]>
  ) {
    super(message, 'VALIDATION_ERROR', 400, false);
  }
}
