import { ApiProperty } from '@nestjs/swagger';
import { JobEventDto } from './job-event.dto.js';
import { PaginationMetaDto } from '../../../common/dto/pagination-meta.dto.js';

export class PaginatedJobEventsDto {
  @ApiProperty({ type: () => JobEventDto, isArray: true })
  data: JobEventDto[];

  @ApiProperty({ type: () => PaginationMetaDto })
  meta: PaginationMetaDto;
}
