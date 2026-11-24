import { SetMetadata } from '@nestjs/common';
import { Role } from '../../generated/prisma/client.js';

export const ROLES_KEY = 'roles';

/** Only users with one of these roles may call the route. No decorator: any signed-in user. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
