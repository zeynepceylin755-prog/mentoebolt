export class DomainError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly shouldLog: boolean;

  constructor(
    message: string,
    code: string = 'DOMAIN_ERROR',
    statusCode: number = 400,
    shouldLog: boolean = false
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.shouldLog = shouldLog;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
