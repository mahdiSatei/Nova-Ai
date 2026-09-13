import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';

/**
 * Attaches a per-request UUID (`req.id`) and echoes it as the
 * `x-request-id` response header. Logging is delegated to
 * `nestjs-pino` (configured in `main.ts`) which picks up the request
 * id automatically. This interceptor exists only to ensure the
 * correlation id exists even before any logger middleware fires.
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { id?: string }>();
    const response = http.getResponse<Response>();

    const incoming = request.headers['x-request-id'];
    const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
    (request as Request & { id: string }).id = id;
    response.setHeader('x-request-id', id);

    return next.handle().pipe(
      tap({
        next: () => {
          // No-op; pino handles request/response logging.
        },
        error: () => {
          // No-op; the global filter logs with the same request id.
        },
      }),
    );
  }
}
