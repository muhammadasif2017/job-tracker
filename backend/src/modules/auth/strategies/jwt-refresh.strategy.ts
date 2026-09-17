import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { Request } from 'express';
import { JwtPayload } from './jwt.strategy.js';

/** The httpOnly cookie carrying the refresh token. */
export const REFRESH_COOKIE_NAME = 'jt_refresh';

/**
 * The `jwt-refresh` strategy guarding the refresh route. Reads the token from
 * the refresh cookie rather than the Authorization header and verifies it
 * against `JWT_REFRESH_SECRET`.
 */
@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: (req: Request) =>
        (req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined) ?? null,
      secretOrKey: config.get<string>('JWT_REFRESH_SECRET')!,
      passReqToCallback: true,
    });
  }

  /**
   * Returns the payload plus the raw refresh token, which the auth service
   * checks against the stored hash.
   */
  validate(req: Request, payload: JwtPayload) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as
      | string
      | undefined;
    if (!refreshToken) throw new UnauthorizedException();
    return { ...payload, refreshToken };
  }
}
