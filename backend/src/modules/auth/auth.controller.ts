import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
  Version,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import ms, { type StringValue } from 'ms';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiExcludeEndpoint,
} from '@nestjs/swagger';
import { AuthService, type OAuthLoginResult } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { ExchangeCodeDto } from './dto/exchange-code.dto.js';
import { ExchangeApiTokenDto } from './dto/exchange-api-token.dto.js';
import { AuthTokensDto } from './dto/auth-tokens.dto.js';
import { ApiTokenAccessDto } from './dto/api-token-access.dto.js';
import { CurrentUserDto } from './dto/current-user.dto.js';
import { MessageDto } from '../../common/dto/message.dto.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { REFRESH_COOKIE_NAME } from './strategies/jwt-refresh.strategy.js';
import { CURRENT_API_PREFIX } from '../../config/api-versioning.helper.js';

/** The refresh cookie's path for a client on the versioned API. */
const REFRESH_COOKIE_PATH = `${CURRENT_API_PREFIX}/auth`;
/** The refresh cookie's path for a client still on the unversioned alias. */
const LEGACY_REFRESH_COOKIE_PATH = '/auth';

/**
 * The cookie path for a request: the auth routes of whichever URL surface the
 * client called (ADR-047). A cookie is only sent to paths under its `Path`,
 * so it has to live where that same client will later refresh. Scoping it by
 * the request keeps a `/v1` client and a pre-versioning client on separate
 * cookies: if an alias refresh wrote to `/v1/auth`, the client's old `/auth`
 * cookie would survive, and its next refresh would replay a revoked token and
 * trip replay detection, which deletes every session the user has.
 */
function refreshCookiePathFor(requestPath: string): string {
  return requestPath.startsWith(`${CURRENT_API_PREFIX}/`)
    ? REFRESH_COOKIE_PATH
    : LEGACY_REFRESH_COOKIE_PATH;
}

/**
 * Every route that mints, rotates or drops a credential. All of them are
 * `@Public()` except logout and `me` — they are how a caller gets a token
 * in the first place — and all of them are rate limited, harder in
 * production than in development so local work and e2e runs are not
 * throttled.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {}

  /**
   * The attributes every refresh-cookie write shares, including the clearing
   * writes on logout. A clearing `Set-Cookie` must carry the same `SameSite`
   * and `Secure` as the original: in production the API is cross-site, and
   * a browser drops a cross-site `Set-Cookie` without `SameSite=None; Secure`,
   * so logout would silently leave the cookie in place.
   */
  private refreshCookieAttributes() {
    const isProduction = this.config.get('NODE_ENV') === 'production';
    return {
      httpOnly: true,
      secure: isProduction,
      // Frontend (Vercel) and backend live on different domains in production,
      // making every request cross-site. SameSite=Lax is only sent on top-level
      // navigations for cross-site requests, so it never reaches the refresh
      // route called via fetch/XHR - the cookie would silently never arrive.
      // None requires Secure, which only holds over HTTPS (production).
      sameSite: isProduction ? ('none' as const) : ('lax' as const),
    };
  }

  /**
   * The refresh token never touches a response body — it is set as an
   * httpOnly cookie scoped to the auth routes the client called (see
   * `refreshCookiePathFor`), so client-side JS, and therefore any XSS,
   * cannot read or exfiltrate it.
   */
  private setRefreshCookie(res: Response, refreshToken: string) {
    const expiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      ...this.refreshCookieAttributes(),
      path: refreshCookiePathFor(res.req.path),
      maxAge: ms(expiresIn as StringValue),
    });
  }

  @Public()
  @Throttle({
    default: {
      ttl: 60000,
      limit: process.env.NODE_ENV === 'production' ? 10 : 100,
    },
  })
  /**
   * Creates an account and signs it in, returning the access token in the
   * body and the refresh token as a cookie.
   */
  @HttpCode(HttpStatus.OK)
  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiOkResponse({ type: AuthTokensDto })
  @ApiBadRequestResponse({ description: 'Email already in use' })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken } = await this.authService.register(dto);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Public()
  @Throttle({
    default: {
      ttl: 60000,
      limit: process.env.NODE_ENV === 'production' ? 10 : 100,
    },
  })
  /**
   * Signs in with email and password. The local Passport guard has already
   * verified the credentials by the time this runs, which is why the
   * handler reads the user off the request rather than the body.
   */
  @UseGuards(AuthGuard('local'))
  @HttpCode(HttpStatus.OK)
  @Post('login')
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ type: AuthTokensDto })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = req.user as { id: string; email: string };
    const { accessToken, refreshToken } = await this.authService.login(
      user.id,
      user.email,
    );
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Public()
  @Throttle({
    default: {
      ttl: 60000,
      limit: process.env.NODE_ENV === 'production' ? 10 : 100,
    },
  })
  /**
   * Rotates the token pair. The refresh guard reads the cookie, so this
   * route takes no body at all.
   */
  @UseGuards(AuthGuard('jwt-refresh'))
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate tokens using the refresh token cookie' })
  @ApiOkResponse({ type: AuthTokensDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired refresh token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = req.user as {
      sub: string;
      jti: string;
      refreshToken: string;
    };
    const { accessToken, refreshToken } = await this.authService.refresh(
      user.sub,
      user.refreshToken,
      user.jti,
    );
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Public()
  @Throttle({
    default: {
      ttl: 60000,
      limit: process.env.NODE_ENV === 'production' ? 10 : 100,
    },
  })
  /**
   * Trades the one-time OAuth code for a real token pair. The browser sends
   * its timezone with it, which is the only point in an OAuth sign-up where
   * that is knowable.
   */
  @HttpCode(HttpStatus.OK)
  @Post('exchange-code')
  @ApiOperation({ summary: 'Exchange short-lived OAuth code for tokens' })
  @ApiOkResponse({ type: AuthTokensDto })
  @ApiForbiddenResponse({ description: 'OAuth code expired or already used' })
  async exchangeCode(
    @Body() dto: ExchangeCodeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken } =
      await this.authService.exchangeOAuthCode(dto.code, dto.timezone);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Public()
  @Throttle({
    default: {
      ttl: 60000,
      limit: process.env.NODE_ENV === 'production' ? 10 : 100,
    },
  })
  @HttpCode(HttpStatus.OK)
  @Post('token/exchange')
  @ApiOperation({
    summary:
      'Exchange a personal access token for a short-lived access JWT (no refresh token/cookie is issued)',
  })
  /**
   * Trades a personal access token for a short-lived access JWT. No refresh
   * token and no cookie are issued: the caller re-exchanges the PAT when
   * the access token expires.
   */
  @ApiOkResponse({ type: ApiTokenAccessDto })
  @ApiForbiddenResponse({ description: 'Invalid or revoked access token' })
  exchangeApiToken(@Body() dto: ExchangeApiTokenDto) {
    return this.authService.exchangeApiToken(dto.token);
  }

  /**
   * Drops every refresh token for the user and clears the cookie. Access
   * tokens already issued remain valid for their remaining minutes.
   */
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invalidate the current refresh token' })
  @ApiOkResponse({ type: MessageDto })
  async logout(
    @CurrentUser() user: { id: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.logout(user.id);
    // Clear both paths: a browser can hold one per URL surface (ADR-047),
    // and logout deleted every refresh token for this user above anyway.
    for (const path of [REFRESH_COOKIE_PATH, LEGACY_REFRESH_COOKIE_PATH]) {
      res.clearCookie(REFRESH_COOKIE_NAME, {
        ...this.refreshCookieAttributes(),
        path,
      });
    }
    return result;
  }

  /**
   * Echoes back whatever the JWT strategy put on the request. Used by the
   * frontend to confirm a token is still good without fetching the full
   * profile.
   */
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  @ApiOkResponse({ type: CurrentUserDto })
  me(@CurrentUser() user: unknown) {
    return user;
  }

  // ── Google OAuth ──────────────────────────────────────────────────────────

  /**
   * Entry point for Google sign-in. Deliberately empty — the Passport guard
   * redirects before the handler would run.
   */
  @Public()
  @Version(VERSION_NEUTRAL)
  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Initiate Google OAuth flow' })
  @ApiExcludeEndpoint()
  googleAuth() {
    // Guard redirects to Google
  }

  /**
   * Where Google sends the user back. The tokens are parked behind a
   * one-time code and only the code travels in the redirect URL, which
   * lands in browser history and server logs.
   */
  @Public()
  @Version(VERSION_NEUTRAL)
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiExcludeEndpoint()
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    await this.redirectWithOAuthCode(req, res);
  }

  // ── GitHub OAuth ──────────────────────────────────────────────────────────

  /**
   * Entry point for GitHub sign-in. Empty for the same reason as
   * `googleAuth`.
   */
  @Public()
  @Version(VERSION_NEUTRAL)
  @Get('github')
  @UseGuards(AuthGuard('github'))
  @ApiOperation({ summary: 'Initiate GitHub OAuth flow' })
  @ApiExcludeEndpoint()
  githubAuth() {
    // Guard redirects to GitHub
  }

  /**
   * Where GitHub sends the user back, handled exactly as the Google
   * callback is.
   */
  @Public()
  @Version(VERSION_NEUTRAL)
  @Get('github/callback')
  @UseGuards(AuthGuard('github'))
  @ApiExcludeEndpoint()
  async githubCallback(@Req() req: Request, @Res() res: Response) {
    await this.redirectWithOAuthCode(req, res);
  }

  /**
   * Parks the provider's sign-in behind a one-time code and sends the browser
   * to the frontend with it. The browser reached this callback by top-level
   * navigation, so an error must also be a redirect: a thrown 503 would leave
   * the user on a bare JSON page on the API origin. `/callback?error=` is
   * the frontend's existing failure path.
   */
  private async redirectWithOAuthCode(req: Request, res: Response) {
    const tokens = req.user as OAuthLoginResult;
    const fe = this.config.get<string>('FRONTEND_URL');
    try {
      const code = await this.authService.storeOAuthCode(tokens);
      res.redirect(`${fe}/callback?code=${code}`);
    } catch (err) {
      if (!(err instanceof ServiceUnavailableException)) throw err;
      res.redirect(`${fe}/callback?error=unavailable`);
    }
  }
}
