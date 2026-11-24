import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '../../generated/prisma/client.js';

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
}

export interface AuthenticatedRequest {
  user?: AuthUser;
}

/** The signed-in user, put on the request by JwtAuthGuard. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.user) {
    throw new Error('CurrentUser used on a public route');
  }
  return request.user;
});
