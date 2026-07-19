import { UnauthorizedException } from '@nestjs/common';
import { LocalStrategy } from './local.strategy.js';
import { AuthService } from '../auth.service.js';

const mockAuthService = { validateLocalUser: jest.fn() };

describe('LocalStrategy', () => {
  let strategy: LocalStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new LocalStrategy(
      mockAuthService as unknown as AuthService,
    );
  });

  it('returns the user when credentials are valid', async () => {
    const user = { id: 'u-1', email: 'a@b.com' };
    mockAuthService.validateLocalUser.mockResolvedValue(user);

    const result = await strategy.validate('a@b.com', 'pass');

    expect(mockAuthService.validateLocalUser).toHaveBeenCalledWith(
      'a@b.com',
      'pass',
    );
    expect(result).toBe(user);
  });

  it('throws UnauthorizedException when validateLocalUser returns null', async () => {
    mockAuthService.validateLocalUser.mockResolvedValue(null);

    await expect(strategy.validate('a@b.com', 'wrong')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
