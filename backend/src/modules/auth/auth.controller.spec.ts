import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { REFRESH_COOKIE_NAME } from './strategies/jwt-refresh.strategy.js';

const mockAuthService = { login: jest.fn() };
const mockConfig = { get: jest.fn().mockReturnValue(undefined) };

const mockRes = () =>
  ({
    cookie: jest.fn(),
  }) as unknown as Response;

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfig.get.mockImplementation((key: string) =>
      key === 'JWT_REFRESH_EXPIRES_IN' ? '7d' : undefined,
    );

    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    controller = module.get(AuthController);
  });

  describe('login', () => {
    it('calls authService.login with the id/email attached by LocalStrategy', async () => {
      mockAuthService.login.mockResolvedValue({
        accessToken: 'at',
        refreshToken: 'rt',
      });
      const req = { user: { id: 'u-1', email: 'a@b.com' } } as unknown as Request;

      await controller.login(req, mockRes());

      expect(mockAuthService.login).toHaveBeenCalledWith('u-1', 'a@b.com');
    });

    it('returns only the access token in the response body', async () => {
      mockAuthService.login.mockResolvedValue({
        accessToken: 'at',
        refreshToken: 'rt',
      });
      const req = { user: { id: 'u-1', email: 'a@b.com' } } as unknown as Request;

      const result = await controller.login(req, mockRes());

      expect(result).toEqual({ accessToken: 'at' });
    });

    it('sets the refresh token as an httpOnly cookie scoped to /auth', async () => {
      mockAuthService.login.mockResolvedValue({
        accessToken: 'at',
        refreshToken: 'rt',
      });
      const req = { user: { id: 'u-1', email: 'a@b.com' } } as unknown as Request;
      const res = mockRes();

      await controller.login(req, res);

      expect(res.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        'rt',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/auth',
        }),
      );
    });
  });
});
