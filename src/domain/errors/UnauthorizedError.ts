import { DomainError } from './DomainError.js';

export class UnauthorizedError extends DomainError {
  constructor(message: string = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401, false);
  }
}
