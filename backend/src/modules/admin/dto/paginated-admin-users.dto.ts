import { ApiProperty } from '@nestjs/swagger';
import { AdminUserDto } from './admin-user.dto.js';
import { PaginationMetaDto } from '../../jobs/dto/pagination-meta.dto.js';

export class PaginatedAdminUsersDto {
  @ApiProperty({ type: () => AdminUserDto, isArray: true })
  data: AdminUserDto[];

  @ApiProperty({ type: () => PaginationMetaDto })
  meta: PaginationMetaDto;
}
