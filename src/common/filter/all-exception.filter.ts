import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError, ValidationError } from '../error/domain.error';
import { redactSecrets } from '../util/redact-secrets';

@Catch()
export class AllExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('AllExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { status, code, message, details } = this.classify(exception);

    this.logger.error(
      `${req.method} ${req.url} → ${status} ${code}: ${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    res.status(status).json({
      statusCode: status,
      code,
      message,
      ...(details ? { details: redactSecrets(details) } : {}),
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }

  private classify(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string }).message ?? exception.message);

      return {
        status: exception.getStatus(),
        code: HttpStatus[exception.getStatus()] ?? 'HTTP_EXCEPTION',
        message: Array.isArray(message) ? message.join('; ') : message,
      };
    }

    if (exception instanceof ValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof DomainError) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: exception instanceof Error ? exception.message : 'Unknown error',
    };
  }
}
