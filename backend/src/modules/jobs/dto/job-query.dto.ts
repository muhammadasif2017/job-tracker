import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { JobPriority, JobStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto.js';

export class JobQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: JobStatus })
  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus;

  // Multi-status filter, used by the kanban board to fetch only the four
  // columns it renders. Takes precedence over `status` (see buildJobWhere) —
  // the two are alternatives, never combined. Accepts either a repeated
  // param (?statusIn=A&statusIn=B) or a comma-separated one (?statusIn=A,B);
  // the transform normalizes both to an array before validation.
  @ApiPropertyOptional({
    enum: JobStatus,
    isArray: true,
    example: ['WISHLIST', 'APPLIED'],
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : value,
  )
  @IsEnum(JobStatus, { each: true })
  statusIn?: JobStatus[];

  @ApiPropertyOptional({ enum: JobPriority })
  @IsOptional()
  @IsEnum(JobPriority)
  priority?: JobPriority;

  @ApiPropertyOptional({ example: 'Google', maxLength: 200 })
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

  @ApiPropertyOptional({
    enum: ['appliedAt', 'company', 'position', 'createdAt', 'status'],
    default: 'appliedAt',
  })
  @IsOptional()
  @IsIn(['appliedAt', 'company', 'position', 'createdAt', 'status'])
  sortBy?: string = 'appliedAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ example: '2024-01-01', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2024-12-31', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
