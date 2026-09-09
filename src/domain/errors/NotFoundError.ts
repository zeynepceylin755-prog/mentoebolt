import { DomainError } from './DomainError.js';

export class NotFoundError extends DomainError {
  constructor(resource: string, id?: string) {
    super(
      `${resource}${id ? ` with id ${id}` : ''} not found`,
      'NOT_FOUND',
      404,
      false
    );
  }
}
