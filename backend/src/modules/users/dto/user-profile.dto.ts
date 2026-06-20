import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserProfileDto {
  @ApiProperty({ format: 'cuid' })
  id: string;

  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ example: 'Jane Doe' })
  name: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.png' })
  avatarUrl: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ example: ['google'], isArray: true, type: String })
  connectedProviders: string[];

  @ApiProperty({ example: true })
  hasPassword: boolean;
}
