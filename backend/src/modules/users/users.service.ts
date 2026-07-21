import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  STORAGE_SERVICE,
  type IStorageService,
} from '../../storage/storage.service.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private storage: IStorageService,
    private logger: Logger,
  ) {}

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
    await this.deleteById(userId);
    return { message: 'Account deleted' };
  }

  // Shared by self-delete (deleteAccount) and admin-initiated deletion.
  async deleteById(userId: string) {
    // Storage files aren't part of the DB cascade — collect keys before the
    // Job/Resume rows disappear, then clean them up after the delete commits.
    const resumes = await this.prisma.resume.findMany({
      where: { job: { userId } },
      select: { storageKey: true },
    });

    await this.prisma.user.delete({ where: { id: userId } });

    await Promise.all(
      resumes.map(({ storageKey }) =>
        this.storage.delete(storageKey).catch((err: unknown) =>
          this.logger.warn('Storage delete failed after account deletion', {
            storageKey,
            err,
          }),
        ),
      ),
    );
  }
}
