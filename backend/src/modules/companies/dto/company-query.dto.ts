import { ApiHideProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Priority } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto.js';

/** Query for the company list: paging, filters and search. */
export class CompanyQueryDto extends PaginationQueryDto {
  /**
   * Accepted and ignored for one release, so a page loaded before the city
   * field was removed can still load the list while both versions run (ADR-057). The
   * release that drops companies.city removes this too.
   */
  @ApiHideProperty()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ enum: Priority })
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @ApiPropertyOptional({ example: 'Systems', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ example: 10, minimum: 1, maximum: 100, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}
