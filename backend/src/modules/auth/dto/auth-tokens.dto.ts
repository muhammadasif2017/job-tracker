import { ApiProperty } from '@nestjs/swagger';

export class AuthTokensDto {
  @ApiProperty({ description: 'JWT access token (15 min)' })
  accessToken: string;
}
