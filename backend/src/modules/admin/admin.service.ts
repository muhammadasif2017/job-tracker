import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UsersService } from '../users/users.service.js';
import { AdminUserQueryDto } from './dto/admin-user-query.dto.js';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
  ) {}

  async listUsers(query: AdminUserQueryDto) {
    const { search, page = 1, limit = 10 } = query;
    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
          _count: { select: { jobs: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: data.map(({ _count, ...user }) => ({
        ...user,
        jobCount: _count.jobs,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        _count: { select: { jobs: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const { _count, ...rest } = user;
    return { ...rest, jobCount: _count.jobs };
  }

  async deleteUser(requestingUserId: string, targetUserId: string) {
    if (requestingUserId === targetUserId) {
      throw new ForbiddenException(
        'Cannot delete your own account from the admin panel',
      );
    }
    await this.getUser(targetUserId); // 404 if missing
    await this.usersService.deleteById(targetUserId);
    return { message: 'User deleted' };
  }
}
