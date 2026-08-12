import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TokenResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Chrome extension' })
  name: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiPropertyOptional({ format: 'date-time' })
  lastUsedAt: Date | null;

  @ApiProperty({ format: 'date-time', description: 'Expires 180 days after creation absent a manual revoke' })
  expiresAt: Date;
}
