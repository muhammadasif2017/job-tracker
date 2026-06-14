import { ApiProperty } from '@nestjs/swagger';
import { JobResponseDto } from './job-response.dto.js';
import { PaginationMetaDto } from './pagination-meta.dto.js';

export class PaginatedJobsDto {
  @ApiProperty({ type: () => JobResponseDto, isArray: true })
  data: JobResponseDto[];

  @ApiProperty({ type: () => PaginationMetaDto })
  meta: PaginationMetaDto;
}
