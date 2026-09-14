import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class CompanyApplicationHistoryQueryDto {
  // An empty or whitespace-only name is allowed and matches nothing — the
  // create forms call this with whatever is typed.
  @ApiProperty({ example: 'Systems Limited', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  name: string;
}
