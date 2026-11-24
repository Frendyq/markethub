import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@markethub.local' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'admin12345' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}

export class RefreshDto {
  @ApiProperty({ description: 'Refresh token from sign-in or the previous refresh' })
  @IsString()
  @MinLength(10)
  refreshToken: string;
}

export class TokensResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;

  @ApiProperty({ description: 'Access token lifetime, e.g. "15m"' })
  expiresIn: string;
}
