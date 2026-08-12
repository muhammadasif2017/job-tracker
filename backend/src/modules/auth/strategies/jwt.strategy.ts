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
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload) {
    const isPat = payload.scope === PAT_SCOPE;
    // patId is only ever absent here if a future call site signs a
    // scope: 'pat' payload without it - fail closed with the same 401 as
    // every other invalid-PAT path, rather than passing undefined to
    // findUnique below.
    if (isPat && !payload.patId) throw new UnauthorizedException();

    // The ApiToken lookup only depends on the payload, not on the user
    // lookup's result, so run them concurrently instead of serially.
    const [user, token] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          role: true,
        },
      }),
      isPat
        ? this.prisma.apiToken.findUnique({
            where: { id: payload.patId },
            select: { revokedAt: true, expiresAt: true },
          })
        : Promise.resolve(null),
    ]);
    if (!user) throw new UnauthorizedException();

    if (isPat) {
      // The JWT itself is stateless and stays valid for its full TTL once
      // signed - re-check the source ApiToken on every request so revoking
      // it (DELETE /tokens/:id) takes effect immediately instead of up to
      // 15 minutes later.
      if (!token || token.revokedAt || token.expiresAt < new Date()) {
        throw new UnauthorizedException();
      }
    }

    // Forward *any* scope claim, not just PAT_SCOPE, so PatScopeGuard sees
    // it and fails closed on a scope it doesn't recognize instead of it
    // being silently dropped here and granting unrestricted access.
    if (!payload.scope) return user;
    return { ...user, scope: payload.scope };
  }
}
