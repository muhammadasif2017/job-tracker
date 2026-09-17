import { ApiProperty } from '@nestjs/swagger';

/**
 * Access token issued in exchange for a personal access token, with its
 * lifetime.
 */
export class ApiTokenAccessDto {
  @ApiProperty({ description: 'JWT access token (15 min)' })
  accessToken: string;

  @ApiProperty({ description: 'Seconds until accessToken expires' })
  expiresIn: number;
}
