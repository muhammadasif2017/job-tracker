import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RefreshDto {
  @ApiProperty({ description: 'JWT refresh token' })
  @IsString()
  refreshToken: string;
}
