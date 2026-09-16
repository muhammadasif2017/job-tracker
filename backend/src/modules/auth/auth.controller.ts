import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
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
   * The refresh token never touches a response body — it is set as an
   * httpOnly cookie scoped to /auth, so client-side JS, and therefore any
   * XSS, cannot read or exfiltrate it.
   */
  private setRefreshCookie(res: Response, refreshToken: string) {
    const expiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';
    const isProduction = this.config.get('NODE_ENV') === 'production';
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: isProduction,
      // Frontend (Vercel) and backend live on different domains in production,
      // making every request cross-site. SameSite=Lax is only sent on top-level
      // navigations for cross-site requests, so it never reaches /auth/refresh
      // called via fetch/XHR - the refresh cookie would silently never arrive.
      // None requires Secure, which only holds over HTTPS (production).
      sameSite: isProduction ? 'none' : 'lax',
      path: '/auth',
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
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/auth' });
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
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiExcludeEndpoint()
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const tokens = req.user as OAuthLoginResult;
    const fe = this.config.get('FRONTEND_URL');
    const code = await this.authService.storeOAuthCode(tokens);
    res.redirect(`${fe}/callback?code=${code}`);
  }

  // ── GitHub OAuth ──────────────────────────────────────────────────────────

  /**
   * Entry point for GitHub sign-in. Empty for the same reason as
   * `googleAuth`.
   */
  @Public()
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
  @Get('github/callback')
  @UseGuards(AuthGuard('github'))
  @ApiExcludeEndpoint()
  async githubCallback(@Req() req: Request, @Res() res: Response) {
    const tokens = req.user as OAuthLoginResult;
    const fe = this.config.get('FRONTEND_URL');
    const code = await this.authService.storeOAuthCode(tokens);
    res.redirect(`${fe}/callback?code=${code}`);
  }
}
