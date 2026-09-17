import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

/** One user row in the admin user list, with their job count. */
export class AdminUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ example: 12 })
  jobCount: number;
}
