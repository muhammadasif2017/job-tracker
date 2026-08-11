import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { PAT_SCOPE } from '../../tokens/tokens.constants.js';

export interface JwtPayload {
  sub: string;
  email: string;
  // Present only on access tokens minted via AuthService.exchangeApiToken
  // (PAT_SCOPE = 'pat'). Absent on normal login/refresh-issued tokens.
  scope?: string;
  // The ApiToken.id this access token was exchanged from. Present whenever
  // scope is set - used to re-check revocation/expiry on every request,
  // since the JWT itself is otherwise stateless and would stay valid for
  // its full TTL even after the PAT is revoked.
  patId?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get<string>('JWT_SECRET')!,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        role: true,
      },
    });
    if (!user) throw new UnauthorizedException();

    if (payload.scope === PAT_SCOPE) {
      // The JWT itself is stateless and stays valid for its full TTL once
      // signed - re-check the source ApiToken on every request so revoking
      // it (DELETE /tokens/:id) takes effect immediately instead of up to
      // 15 minutes later.
      const token = await this.prisma.apiToken.findUnique({
        where: { id: payload.patId },
        select: { revokedAt: true, expiresAt: true },
      });
      if (!token || token.revokedAt || token.expiresAt < new Date()) {
        throw new UnauthorizedException();
      }
      return { ...user, scope: payload.scope };
    }

    return user;
  }
}
