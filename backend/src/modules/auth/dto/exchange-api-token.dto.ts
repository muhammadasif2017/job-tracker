import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ExchangeApiTokenDto {
  @ApiProperty({
    description: 'Raw personal access token, e.g. from the browser extension',
    example: 'jt_pat_4e1f0a3c-9b7d-4a2e-8c6f-1d5b6a0e2f3c.9f8e7d6c5b4a3928...',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token: string;
}
