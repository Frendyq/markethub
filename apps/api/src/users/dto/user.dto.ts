import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { Role, type User } from '../../generated/prisma/client.js';

export class CreateUserDto {
  @ApiProperty({ example: 'manager@markethub.local' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Aigerim' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({ enum: Role, default: Role.MANAGER })
  @IsEnum(Role)
  role: Role = Role.MANAGER;
}

export class UserResponseDto {
  @ApiProperty() id: number;
  @ApiProperty() email: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: Role }) role: Role;
  @ApiProperty() createdAt: Date;
}

/** Never return the row itself: it carries the password hash. */
export function toUserResponse(user: User): UserResponseDto {
  return { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt };
}
