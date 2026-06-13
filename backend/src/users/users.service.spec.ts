import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  describe('getProfile', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getProfile('u-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('excludes the password hash from the returned profile', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'a@b.com',
        name: 'Alice',
        avatarUrl: null,
        createdAt: new Date(),
        password: '$2b$10$hashed',
        accounts: [],
      });
      const profile = await service.getProfile('u-1');
      expect(profile).not.toHaveProperty('password');
    });

    it('maps accounts to a connectedProviders string array', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'a@b.com',
        name: 'Alice',
        avatarUrl: null,
        createdAt: new Date(),
        password: null,
        accounts: [{ provider: 'google' }, { provider: 'github' }],
      });
      const profile = await service.getProfile('u-1');
      expect(profile.connectedProviders).toEqual(['google', 'github']);
    });

    it('sets hasPassword true when a password hash is stored', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'a@b.com',
        name: 'Alice',
        avatarUrl: null,
        createdAt: new Date(),
        password: '$2b$10$hashed',
        accounts: [],
      });
      const profile = await service.getProfile('u-1');
      expect(profile.hasPassword).toBe(true);
    });

    it('sets hasPassword false for social-login-only accounts', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'a@b.com',
        name: 'Alice',
        avatarUrl: null,
        createdAt: new Date(),
        password: null,
        accounts: [{ provider: 'google' }],
      });
      const profile = await service.getProfile('u-1');
      expect(profile.hasPassword).toBe(false);
    });
  });

  describe('updateProfile', () => {
    it('throws BadRequestException when the new email is already taken by another user', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u-2' });
      await expect(
        service.updateProfile('u-1', { email: 'taken@example.com' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('skips the email uniqueness check when no email is in the dto', async () => {
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'a@b.com',
        name: 'New Name',
        avatarUrl: null,
        createdAt: new Date(),
        password: null,
        accounts: [],
      });
      await service.updateProfile('u-1', { name: 'New Name' });
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('updates and returns the full profile shape', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'new@b.com',
        name: 'Alice',
        avatarUrl: null,
        createdAt: new Date(),
        password: '$2b$hash',
        accounts: [{ provider: 'google' }],
      });
      const result = await service.updateProfile('u-1', { email: 'new@b.com' });
      expect(result).toMatchObject({
        id: 'u-1',
        email: 'new@b.com',
        hasPassword: true,
        connectedProviders: ['google'],
      });
    });
  });

  describe('changePassword', () => {
    it('throws ForbiddenException for social-login accounts that have no password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        password: null,
      });
      await expect(
        service.changePassword('u-1', {
          currentPassword: 'any',
          newPassword: 'new-pass',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when the current password is incorrect', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        password: '$2b$hash',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(
        service.changePassword('u-1', {
          currentPassword: 'wrong',
          newPassword: 'new-pass',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('hashes the new password and persists it', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        password: '$2b$old',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$new');
      mockPrisma.user.update.mockResolvedValue({});

      await service.changePassword('u-1', {
        currentPassword: 'correct',
        newPassword: 'new-pass',
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { password: '$2b$new' },
      });
    });

    it('returns a success message', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        password: '$2b$old',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$new');
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.changePassword('u-1', {
        currentPassword: 'correct',
        newPassword: 'new-pass',
      });

      expect(result).toEqual({ message: 'Password updated successfully' });
    });
  });

  describe('deleteAccount', () => {
    it('deletes the user by id', async () => {
      mockPrisma.user.delete.mockResolvedValue({});
      await service.deleteAccount('u-1');
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'u-1' },
      });
    });

    it('returns a success message', async () => {
      mockPrisma.user.delete.mockResolvedValue({});
      const result = await service.deleteAccount('u-1');
      expect(result).toEqual({ message: 'Account deleted' });
    });
  });
});
