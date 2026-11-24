import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route that needs no access token (sign-in, health checks, webhooks). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
