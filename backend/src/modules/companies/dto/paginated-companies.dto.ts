import { ApiProperty } from '@nestjs/swagger';
import { CompanyResponseDto } from './company-response.dto.js';
import { PaginationMetaDto } from '../../../common/dto/pagination-meta.dto.js';

export class PaginatedCompaniesDto {
  @ApiProperty({ type: () => CompanyResponseDto, isArray: true })
  data: CompanyResponseDto[];

  @ApiProperty({ type: () => PaginationMetaDto })
  meta: PaginationMetaDto;
}
