import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class CurrentUserDto {
  @ApiProperty({ format: 'cuid' })
  id: string;

  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ example: 'Jane Doe' })
  name: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.png' })
  avatarUrl: string | null;

  @ApiProperty({ enum: Role })
  role: Role;
}
