import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

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

  // Auto-detected by the browser, never typed, so an unrecognized value must
  // never fail the signup — the service falls back to UTC instead. Deliberately
  // NOT validated with @IsIanaTimezone: that decorator tests membership of
  // Intl.supportedValuesOf('timeZone'), which lists only one name per zone.
  // A browser reports `Asia/Kolkata` and `Europe/Kyiv` while Node lists their
  // legacy aliases `Asia/Calcutta` and `Europe/Kiev`, so the strict check
  // would 400 a perfectly good zone and block registration outright.
  @ApiPropertyOptional({ example: 'Asia/Karachi', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
