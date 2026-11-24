import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

/**
 * Settings shared by main.ts and the e2e tests (the testing app doesn't run main.ts).
 * Pipes, filters, guards and interceptors are registered as APP_* providers in AppModule,
 * so tests get them too.
 */
export function configureApp(app: INestApplication, corsOrigins: string): void {
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] });
  // Supplier price lists are posted as text/csv, up to 10 MB.
  (app as NestExpressApplication).useBodyParser('text', { type: 'text/csv', limit: '10mb' });
  app.use(helmet());
  app.enableCors({
    origin: corsOrigins.split(',').map((origin) => origin.trim()).filter(Boolean),
    credentials: true,
  });
  app.enableShutdownHooks();
}
