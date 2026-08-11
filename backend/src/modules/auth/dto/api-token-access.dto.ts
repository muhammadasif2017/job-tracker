import { ApiProperty } from '@nestjs/swagger';

export class ApiTokenAccessDto {
  @ApiProperty({ description: 'JWT access token (15 min)' })
  accessToken: string;

  @ApiProperty({ description: 'Seconds until accessToken expires' })
  expiresIn: number;
}
