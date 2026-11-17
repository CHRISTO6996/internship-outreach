export class IntegrationError extends Error {
  constructor(message, { integration = null, env = [] } = {}) {
    super(message);
    this.name = 'IntegrationError';
    this.code = 'integration_not_configured';
    this.integration = integration;
    this.env = env;
  }
}

export class ValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'validation_error';
    this.status = 400;
    this.details = details;
  }
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.code = 'not_found';
    this.status = 404;
  }
}

export class ConflictError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'ConflictError';
    this.code = 'conflict';
    this.status = 409;
    this.details = details;
  }
}
