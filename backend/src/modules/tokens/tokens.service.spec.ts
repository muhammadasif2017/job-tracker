import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { TokensService } from './tokens.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { API_TOKEN_PREFIX, MAX_ACTIVE_TOKENS_PER_USER } from './tokens.constants.js';

jest.mock('bcrypt');

const mockPrisma = {
  apiToken: {
    create: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
};

describe('TokensService', () => {
  let service: TokensService;

  beforeEach(async () => {
    jest.clearAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-secret');
    mockPrisma.apiToken.count.mockResolvedValue(0);
    const module = await Test.createTestingModule({
      providers: [
        TokensService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(TokensService);
  });

  describe('create', () => {
    it('creates a token row and returns the raw token exactly once', async () => {
      mockPrisma.apiToken.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: data.id,
          name: data.name,
          createdAt: new Date('2026-01-01'),
          lastUsedAt: null,
          expiresAt: data.expiresAt,
        }),
      );

      const result = await service.create('user-1', { name: 'Chrome extension' });

      expect(mockPrisma.apiToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          name: 'Chrome extension',
          tokenHash: 'hashed-secret',
          expiresAt: expect.any(Date),
        }),
      });
      expect(result.token.startsWith(API_TOKEN_PREFIX)).toBe(true);
      expect(result.token).toContain(`${API_TOKEN_PREFIX}${result.id}.`);
      expect(result.name).toBe('Chrome extension');
    });

    it('rejects once the active token count reaches the cap', async () => {
      mockPrisma.apiToken.count.mockResolvedValue(MAX_ACTIVE_TOKENS_PER_USER);

      await expect(
        service.create('user-1', { name: 'One too many' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.apiToken.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('lists only non-revoked tokens for the user, masked', async () => {
      const expiresAt = new Date('2026-07-01');
      mockPrisma.apiToken.findMany.mockResolvedValue([
        {
          id: 't-1',
          name: 'Chrome extension',
          createdAt: new Date('2026-01-01'),
          lastUsedAt: null,
          expiresAt,
          tokenHash: 'should-not-leak',
        },
      ]);

      const result = await service.findAll('user-1');

      expect(mockPrisma.apiToken.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual([
        {
          id: 't-1',
          name: 'Chrome extension',
          createdAt: new Date('2026-01-01'),
          lastUsedAt: null,
          expiresAt,
        },
      ]);
    });
  });

  describe('revoke', () => {
    it('throws NotFoundException when nothing was revoked', async () => {
      mockPrisma.apiToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.revoke('user-1', 't-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-revokes a token owned by the user', async () => {
      mockPrisma.apiToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.revoke('user-1', 't-1');

      expect(mockPrisma.apiToken.updateMany).toHaveBeenCalledWith({
        where: { id: 't-1', userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result).toEqual({ message: 'Token revoked' });
    });
  });
});
