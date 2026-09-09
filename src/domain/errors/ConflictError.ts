import { DomainError } from './DomainError.js';

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409, false);
  }
}
