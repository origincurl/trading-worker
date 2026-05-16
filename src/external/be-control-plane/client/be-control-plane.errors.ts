import { IntegrationError } from '@common/error/domain.error';

export class BeNetworkError extends IntegrationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(`BE network error: ${message}`, { ...details, source: 'be-control-plane' });
  }
}
