import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class ParseJobDto {
  @ApiPropertyOptional({ example: 'https://jobs.example.com/123' })
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  url?: string;

  @ApiPropertyOptional({ example: 'Senior Engineer at Acme...' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  text?: string;
}
