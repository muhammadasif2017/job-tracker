import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import {
  STORAGE_SERVICE,
  type IStorageService,
} from '../../infrastructure/storage/storage.service.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { UpdateNotificationPrefsDto } from './dto/update-notification-prefs.dto.js';

/**
 * The signed-in user acting on their own account: profile, notification
 * preferences, password and deletion. Every method takes the id from the
 * access token, so there is no route here that can reach another user's
 * row.
 */
@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private storage: IStorageService,
    private logger: Logger,
  ) {}

  /**
   * The single shape every method in this service returns, so a profile
   * read and a profile write cannot drift apart. Sensitive columns are
   * dropped here rather than at each call site.
   */
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
        interviewRemindersEnabled: true,
        digestFrequency: true,
        timezone: true,
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

  /** Returns the caller's own profile. */
  async getProfile(userId: string) {
    return await this.toProfile(userId);
  }

  /**
   * Updates name or email. The email uniqueness check is a friendly 400
   * ahead of the database's own unique constraint, which would otherwise
   * surface as a 409 with no field named.
   */
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

  /**
   * Updates the reminder and digest settings, plus the timezone those are
   * scheduled against.
   */
  async updateNotificationPrefs(
    userId: string,
    dto: UpdateNotificationPrefsDto,
  ) {
    await this.prisma.user.update({ where: { id: userId }, data: dto });
    return await this.toProfile(userId);
  }

  /**
   * Changes the password after re-checking the current one. An account
   * created through OAuth has no password to verify against, so it is
   * refused rather than allowed to set one blind.
   */
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

  /** Deletes the caller's own account and everything that cascades from it. */
  async deleteAccount(userId: string) {
    await this.deleteById(userId);
    return { message: 'Account deleted' };
  }

  /**
   * Shared by self-delete (`deleteAccount`) and admin-initiated deletion,
   * so both paths clean up identically.
   *
   * Storage files are not part of the database cascade — the keys are
   * collected before the Job/Resume rows disappear, and deleted after the
   * row delete commits. A failed file delete is logged, never rethrown: the
   * account is already gone and an orphaned file must not turn that into an
   * error the user sees.
   */
  async deleteById(userId: string) {
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
