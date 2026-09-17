import { ApiProperty } from '@nestjs/swagger';

/**
 * Access token returned by login, register, refresh and OAuth code exchange.
 * The refresh token travels only in its httpOnly cookie.
 */
export class AuthTokensDto {
  @ApiProperty({ description: 'JWT access token (15 min)' })
  accessToken: string;
}
