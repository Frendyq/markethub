import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedRequest } from '../common/decorators/current-user.decorator.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SKIP = [/^\/api\/auth\//, /^\/api\/webhooks\//];

/**
 * Writes "who changed what" for every successful write request of a signed-in user.
 * The audit row is written after the response is ready and never fails the request.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    if (!MUTATING.has(request.method) || SKIP.some((pattern) => pattern.test(request.path))) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        const routePath = (request.route as { path?: string } | undefined)?.path ?? request.path;
        const [, , entity] = routePath.split('/'); // "/api/products/:id" -> "products"
        const entityId = Object.values(request.params ?? {})[0];
        this.prisma.auditLog
          .create({
            data: {
              userId: request.user?.id,
              action: `${request.method} ${routePath}`,
              entity,
              entityId: typeof entityId === 'string' ? entityId : undefined,
              details: sanitize(request.body),
            },
          })
          .catch((error: unknown) => this.logger.warn(`Audit write failed: ${String(error)}`));
      }),
    );
  }
}

function sanitize(body: unknown): object | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  const copy: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const key of ['password', 'refreshToken']) {
    if (key in copy) {
      copy[key] = '***';
    }
  }
  return copy;
}
