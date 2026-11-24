import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';

const REASON: Partial<Record<number, string>> = {
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
};

interface DriverCause {
  originalCode?: string;
  originalMessage?: string;
  constraint?: { index?: string; fields?: string[] };
}

/**
 * Turns database constraint errors into proper HTTP answers instead of 500s.
 * We insert and catch the violation rather than checking first: a check-then-insert
 * lets two concurrent requests both pass the check.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, message } = this.map(error);
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`Unhandled Prisma error ${error.code}: ${error.message}`, error.stack);
    }
    response.status(status).json({ statusCode: status, message, error: REASON[status] });
  }

  private map(error: Prisma.PrismaClientKnownRequestError): { status: number; message: string } {
    const cause = driverCause(error);
    switch (error.code) {
      case 'P2002':
        return { status: HttpStatus.CONFLICT, message: `Already exists (${constraintName(error, cause)})` };
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, message: 'Not found' };
      case 'P2003':
        return { status: HttpStatus.CONFLICT, message: 'Referenced record does not exist or is still in use' };
    }
    // Raw queries (P2010) report the PostgreSQL code directly.
    if (cause?.originalCode === '23514') {
      return { status: HttpStatus.CONFLICT, message: 'The change breaks a stock or price rule' };
    }
    if (cause?.originalCode === '23505') {
      return { status: HttpStatus.CONFLICT, message: 'Already exists' };
    }
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' };
  }
}

function driverCause(error: Prisma.PrismaClientKnownRequestError): DriverCause | undefined {
  const meta = error.meta as { driverAdapterError?: { cause?: DriverCause } } | undefined;
  return meta?.driverAdapterError?.cause;
}

function constraintName(error: Prisma.PrismaClientKnownRequestError, cause: DriverCause | undefined): string {
  const target = (error.meta as { target?: string[] | string } | undefined)?.target;
  if (Array.isArray(target)) {
    return target.join(', ');
  }
  return target ?? cause?.constraint?.fields?.join(', ') ?? cause?.constraint?.index ?? 'unique field';
}
