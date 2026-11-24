import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import type { Env } from './config/env.js';

async function bootstrap(): Promise<void> {
  // rawBody: webhook signatures are checked against the exact bytes that were sent.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  configureApp(app, config.get('CORS_ORIGINS', { infer: true }));

  const openApi = new DocumentBuilder()
    .setTitle('MarketHub API')
    .setDescription('Catalog, stock, listings and orders for several marketplaces')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, openApi));

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  Logger.log(`API on http://localhost:${port}/api, docs on http://localhost:${port}/docs`, 'Bootstrap');
}

await bootstrap();
