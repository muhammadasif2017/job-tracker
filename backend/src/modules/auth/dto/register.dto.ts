import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Email-and-password signup body. */
export class RegisterDto {
  @ApiProperty({ example: 'Jane Doe', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  /**
   * Auto-detected by the browser, never typed, so an unrecognized value must
   * never fail the signup — the service falls back to UTC instead. Deliberately
   * NOT validated with @IsIanaTimezone, which 400s any name Intl cannot
   * resolve: a bad detected zone is worth storing as UTC, not worth blocking
   * registration outright.
   */
  @ApiPropertyOptional({ example: 'Asia/Karachi', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
