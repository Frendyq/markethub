import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

// Global on purpose: the database client is infrastructure that every feature needs.
// Feature modules themselves are never global.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
