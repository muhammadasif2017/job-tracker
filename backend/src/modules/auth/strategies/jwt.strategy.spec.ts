import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

const mockConfig = { get: jest.fn().mockReturnValue('secret') };
const mockPrisma = {
  user: { findUnique: jest.fn() },
  apiToken: { findUnique: jest.fn() },
};

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(
      mockConfig as unknown as ConfigService,
      mockPrisma as unknown as PrismaService,
    );
  });

  it('throws UnauthorizedException when the user no longer exists', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'u-1', email: 'a@b.com' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('returns the user unchanged for a normal (non-PAT) token', async () => {
    const user = { id: 'u-1', email: 'a@b.com', name: 'A', avatarUrl: null, role: 'USER' };
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const result = await strategy.validate({ sub: 'u-1', email: 'a@b.com' });

    expect(result).toEqual(user);
    expect(result).not.toHaveProperty('scope');
  });

  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

  it('attaches the scope claim for a PAT-derived token whose source ApiToken is still active', async () => {
    const user = { id: 'u-1', email: 'a@b.com', name: 'A', avatarUrl: null, role: 'USER' };
    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPrisma.apiToken.findUnique.mockResolvedValue({
      revokedAt: null,
      expiresAt: future,
    });

    const result = await strategy.validate({
      sub: 'u-1',
      email: 'a@b.com',
      scope: 'pat',
      patId: 'tok-1',
    });

    expect(result).toEqual({ ...user, scope: 'pat' });
    expect(mockPrisma.apiToken.findUnique).toHaveBeenCalledWith({
      where: { id: 'tok-1' },
      select: { revokedAt: true, expiresAt: true },
    });
  });

  it('rejects a PAT-derived token whose source ApiToken has been revoked', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-1' });
    mockPrisma.apiToken.findUnique.mockResolvedValue({
      revokedAt: new Date(),
      expiresAt: future,
    });

    await expect(
      strategy.validate({
        sub: 'u-1',
        email: 'a@b.com',
        scope: 'pat',
        patId: 'tok-1',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a PAT-derived token whose source ApiToken has expired', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-1' });
    mockPrisma.apiToken.findUnique.mockResolvedValue({
      revokedAt: null,
      expiresAt: past,
    });

    await expect(
      strategy.validate({
        sub: 'u-1',
        email: 'a@b.com',
        scope: 'pat',
        patId: 'tok-1',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a PAT-derived token whose source ApiToken no longer exists', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-1' });
    mockPrisma.apiToken.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate({
        sub: 'u-1',
        email: 'a@b.com',
        scope: 'pat',
        patId: 'tok-1',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
