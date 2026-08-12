import { ApiProperty } from '@nestjs/swagger';
import { TokenResponseDto } from './token-response.dto.js';

export class CreatedTokenDto extends TokenResponseDto {
  @ApiProperty({
    description: 'Raw token value — shown only once, on creation',
    example: 'jt_pat_4e1f0a3c-9b7d-4a2e-8c6f-1d5b6a0e2f3c.9f8e7d6c5b4a3928...',
  })
  token: string;
}
