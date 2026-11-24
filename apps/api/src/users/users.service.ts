import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword } from '../auth/password.js';
import { CreateUserDto, toUserResponse, UserResponseDto } from './dto/user.dto.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<UserResponseDto[]> {
    const users = await this.prisma.user.findMany({ orderBy: { id: 'asc' } });
    return users.map(toUserResponse);
  }

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    // A duplicate email hits the unique index and becomes 409 in PrismaExceptionFilter.
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        name: dto.name,
        role: dto.role,
        passwordHash: await hashPassword(dto.password),
      },
    });
    return toUserResponse(user);
  }
}
