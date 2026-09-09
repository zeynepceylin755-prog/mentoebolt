import { DomainError } from './DomainError.js';

export class AuthenticationError extends DomainError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'AUTHENTICATION_ERROR', 401, false);
  }
}

export class AuthorizationError extends DomainError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 'AUTHORIZATION_ERROR', 403, false);
  }
}

export class AccountLockedError extends DomainError {
  constructor(message: string = 'Account is locked') {
    super(message, 'ACCOUNT_LOCKED', 423, false);
  }
}

export class EmailNotVerifiedError extends DomainError {
  constructor(message: string = 'Email not verified') {
    super(message, 'EMAIL_NOT_VERIFIED', 403, false);
  }
}
