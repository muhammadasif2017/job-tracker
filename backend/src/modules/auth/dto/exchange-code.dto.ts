import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ExchangeCodeDto {
  @ApiProperty({
    description: 'Short-lived UUID code from OAuth redirect',
    format: 'uuid',
  })
  @IsUUID('4')
  code: string;

  // Browser-detected, stored only when this sign-in created the account.
  // Validated loosely on purpose, like RegisterDto.timezone: a 400 here would
  // fail the whole sign-in, so an unusable value falls back to UTC instead.
  @ApiPropertyOptional({ example: 'Asia/Karachi', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
