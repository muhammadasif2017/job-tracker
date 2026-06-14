import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ExchangeCodeDto {
  @ApiProperty({
    description: 'Short-lived UUID code from OAuth redirect',
    format: 'uuid',
  })
  @IsUUID('4')
  code: string;
}
