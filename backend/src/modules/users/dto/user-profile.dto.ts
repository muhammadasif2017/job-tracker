import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DigestFrequency } from '@prisma/client';

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

  @ApiProperty({ example: true })
  interviewRemindersEnabled: boolean;

  @ApiProperty({ enum: DigestFrequency, example: DigestFrequency.OFF })
  digestFrequency: DigestFrequency;

  @ApiProperty({ example: 'Asia/Karachi' })
  timezone: string;
}
