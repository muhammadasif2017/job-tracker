import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  private async toProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        createdAt: true,
        password: true,
        accounts: { select: { provider: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    // Destructure out password/accounts so the hash never reaches the client;
    // expose only a boolean the UI can use to decide whether to offer
    // "change password".
    const { password, accounts, ...rest } = user;
    return {
      ...rest,
      connectedProviders: accounts.map((a) => a.provider),
      hasPassword: !!password,
    };
  }

  async getProfile(userId: string) {
    return await this.toProfile(userId);
  }

  async updateProfile(userId: string, dto: UpdateUserDto) {
    if (dto.email) {
      const taken = await this.prisma.user.findFirst({
        where: { email: dto.email, NOT: { id: userId } },
      });
      if (taken) throw new BadRequestException('Email already in use');
    }

    await this.prisma.user.update({ where: { id: userId }, data: dto });
    return await this.toProfile(userId);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.password) {
      throw new ForbiddenException(
        'Account uses social login — set a password first',
      );
    }

    const valid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const hashed = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });

    return { message: 'Password updated successfully' };
  }

  async deleteAccount(userId: string) {
    await this.prisma.user.delete({ where: { id: userId } });
    return { message: 'Account deleted' };
  }
}
