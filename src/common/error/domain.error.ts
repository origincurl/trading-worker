export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);

    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', details);
  }
}

export class IntegrationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'INTEGRATION_ERROR', details);
  }
}

export class RateLimitExceededError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'RATE_LIMIT_EXCEEDED', details);
  }
}

export class NotImplementedError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'NOT_IMPLEMENTED', details);
  }
}
