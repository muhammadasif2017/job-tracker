import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UsersService } from '../users/users.service.js';

const mockPrisma = {
  user: {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
  },
};

const mockUsersService = {
  deleteById: jest.fn(),
};

const baseUser = {
  id: 'u-1',
  email: 'a@b.com',
  name: 'Alice',
  role: 'USER',
  createdAt: new Date(),
  _count: { jobs: 3 },
};

describe('AdminService', () => {
  let service: AdminService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();
    service = module.get(AdminService);
  });

  describe('listUsers', () => {
    it('queries without a where filter when search is omitted', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.listUsers({ page: 1, limit: 10 });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
      expect(mockPrisma.user.count).toHaveBeenCalledWith({ where: {} });
    });

    it('builds a case-insensitive OR filter on name/email when search is set', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.listUsers({ page: 1, limit: 10, search: 'jane' });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { name: { contains: 'jane', mode: 'insensitive' } },
              { email: { contains: 'jane', mode: 'insensitive' } },
            ],
          },
        }),
      );
    });

    it('applies page/limit as skip/take', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.listUsers({ page: 3, limit: 20 });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 40, take: 20 }),
      );
    });

    it('maps _count.jobs to jobCount and computes totalPages', async () => {
      mockPrisma.user.findMany.mockResolvedValue([baseUser]);
      mockPrisma.user.count.mockResolvedValue(25);

      const result = await service.listUsers({ page: 1, limit: 10 });

      expect(result.data).toEqual([
        {
          id: 'u-1',
          email: 'a@b.com',
          name: 'Alice',
          role: 'USER',
          createdAt: baseUser.createdAt,
          jobCount: 3,
        },
      ]);
      expect(result.data[0]).not.toHaveProperty('_count');
      expect(result.meta).toEqual({
        total: 25,
        page: 1,
        limit: 10,
        totalPages: 3,
      });
    });
  });

  describe('getUser', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getUser('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('maps _count.jobs to jobCount', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);
      const result = await service.getUser('u-1');
      expect(result).toEqual({
        id: 'u-1',
        email: 'a@b.com',
        name: 'Alice',
        role: 'USER',
        createdAt: baseUser.createdAt,
        jobCount: 3,
      });
    });
  });

  describe('deleteUser', () => {
    it('throws ForbiddenException when deleting your own account', async () => {
      await expect(service.deleteUser('u-1', 'u-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockUsersService.deleteById).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the target does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.deleteUser('u-1', 'u-2')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockUsersService.deleteById).not.toHaveBeenCalled();
    });

    it('delegates to UsersService.deleteById for a different, existing user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(baseUser);
      mockUsersService.deleteById.mockResolvedValue(undefined);

      const result = await service.deleteUser('admin-1', 'u-1');

      expect(mockUsersService.deleteById).toHaveBeenCalledWith('u-1');
      expect(result).toEqual({ message: 'User deleted' });
    });
  });
});
