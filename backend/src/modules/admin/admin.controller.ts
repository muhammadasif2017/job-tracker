import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AdminService } from './admin.service.js';
import { AdminUserQueryDto } from './dto/admin-user-query.dto.js';
import { AdminUserDto } from './dto/admin-user.dto.js';
import { PaginatedAdminUsersDto } from './dto/paginated-admin-users.dto.js';
import { MessageDto } from '../../common/dto/message.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';

/**
 * Admin-only user management. `@Roles(Role.ADMIN)` sits on the class, so
 * every route inherits it — there is no unguarded route here to add by
 * accident.
 */
@ApiTags('admin')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@ApiForbiddenResponse({ description: 'Requires ADMIN role' })
@Roles(Role.ADMIN)
@Controller('admin/users')
export class AdminController {
  constructor(private adminService: AdminService) {}

  /** Lists users, paginated and searchable. */
  @Get()
  @ApiOperation({ summary: 'List all users with pagination and search' })
  @ApiOkResponse({ type: PaginatedAdminUsersDto })
  findAll(@Query() query: AdminUserQueryDto) {
    return this.adminService.listUsers(query);
  }

  /** Fetches one user by id. */
  @Get(':id')
  @ApiOperation({ summary: 'Get a single user' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiOkResponse({ type: AdminUserDto })
  @ApiNotFoundResponse({ description: 'User not found' })
  findOne(@Param('id') id: string) {
    return this.adminService.getUser(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a user account' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiOkResponse({ type: MessageDto })
  @ApiForbiddenResponse({
    description:
      'Requires ADMIN role, or attempting to delete your own account',
  })
  /**
   * Deletes a user. Passes the caller's own id through so the service can
   * refuse a self-delete.
   */
  @ApiNotFoundResponse({ description: 'User not found' })
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.adminService.deleteUser(user.id, id);
  }
}
