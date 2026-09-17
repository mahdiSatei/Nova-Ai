import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
}

/**
 * Translates every uncaught error into the project's sanitized error
 * envelope `{ code, message, requestId }`. Internal details (stack
 * traces, ORM messages, TypeORM error codes) are NEVER leaked to the
 * client; they are logged with the request id for support.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { req?: { id?: string } }>();
    const requestId =
      request.headers['x-request-id']?.toString() ??
      request.req?.id ??
      randomUUID();

    const { status, body } = this.translate(exception, requestId);

    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${request.method} ${request.url} -> ${status} ${body.code}: ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `[${requestId}] ${request.method} ${request.url} -> ${status} ${body.code}: ${body.message}`,
      );
    }

    response.setHeader('x-request-id', requestId);
    response.status(status).json(body);
  }

  private translate(exception: unknown, requestId: string): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resp = exception.getResponse();
      const respObj =
        typeof resp === 'object' && resp !== null
          ? (resp as Record<string, unknown>)
          : null;
      // Honor an explicit `code` on the HttpException body when present,
      // otherwise fall back to status-based defaults.
      const explicitCode = respObj?.['code'];
      const code =
        typeof explicitCode === 'string' && explicitCode.length > 0
          ? explicitCode
          : this.codeForStatus(status);
      const rawMessage = respObj?.['message'];
      const message = Array.isArray(rawMessage)
        ? (rawMessage as string[]).join('; ')
        : typeof rawMessage === 'string'
          ? rawMessage
          : exception.message;
      return {
        status,
        body: {
          code,
          message: this.sanitizeMessage(status, message),
          requestId,
        },
      };
    }

    // Unknown error — log internally, return generic 500 to the client.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
        requestId,
      },
    };
  }

  private codeForStatus(status: number): string {
    switch (status as HttpStatus) {
      case HttpStatus.BAD_REQUEST:
        return 'validation_failed';
      case HttpStatus.UNAUTHORIZED:
        return 'invalid_token';
      case HttpStatus.FORBIDDEN:
        return 'forbidden';
      case HttpStatus.NOT_FOUND:
        return 'not_found';
      case HttpStatus.CONFLICT:
        return 'conflict';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'unprocessable_entity';
      default:
        return status >= 500 ? 'internal_error' : 'error';
    }
  }

  private sanitizeMessage(status: number, message: string): string {
    if (status >= 500) return 'An unexpected error occurred.';
    return message;
  }
}
