import { ApiProperty } from '@nestjs/swagger';
import { AdminUserDto } from './admin-user.dto.js';
import { PaginationMetaDto } from '../../../common/dto/pagination-meta.dto.js';

/** One page of the admin user list. */
export class PaginatedAdminUsersDto {
  @ApiProperty({ type: () => AdminUserDto, isArray: true })
  data: AdminUserDto[];

  @ApiProperty({ type: () => PaginationMetaDto })
  meta: PaginationMetaDto;
}
