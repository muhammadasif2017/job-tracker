import { ApiProperty } from '@nestjs/swagger';
import { JobResponseDto } from './job-response.dto.js';
import { PaginationMetaDto } from '../../../common/dto/pagination-meta.dto.js';

/** One page of the job list. */
export class PaginatedJobsDto {
  @ApiProperty({ type: () => JobResponseDto, isArray: true })
  data: JobResponseDto[];

  @ApiProperty({ type: () => PaginationMetaDto })
  meta: PaginationMetaDto;
}
