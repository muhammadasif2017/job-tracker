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
  ApiConflictResponse,
  ApiBearerAuth,
  ApiExcludeEndpoint,
} from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { ExchangeCodeDto } from './dto/exchange-code.dto.js';
import { AuthTokensDto } from './dto/auth-tokens.dto.js';
import { CurrentUserDto } from './dto/current-user.dto.js';
import { MessageDto } from '../../common/dto/message.dto.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { REFRESH_COOKIE_NAME } from './strategies/jwt-refresh.strategy.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {}

  // Refresh token never touches the response body — set as an httpOnly cookie
  // scoped to /auth so client-side JS (and any XSS) can't read or exfiltrate it.
  private setRefreshCookie(res: Response, refreshToken: string) {
    const expiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'lax',
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
  @HttpCode(HttpStatus.OK)
  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiOkResponse({ type: AuthTokensDto })
  @ApiConflictResponse({ description: 'Email already in use' })
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
      email: string;
      jti: string;
      refreshToken: string;
    };
    const { accessToken, refreshToken } = await this.authService.refresh(
      user.sub,
      user.email,
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
  @HttpCode(HttpStatus.OK)
  @Post('exchange-code')
  @ApiOperation({ summary: 'Exchange short-lived OAuth code for tokens' })
  @ApiOkResponse({ type: AuthTokensDto })
  async exchangeCode(
    @Body() dto: ExchangeCodeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken } =
      await this.authService.exchangeOAuthCode(dto.code);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

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

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  @ApiOkResponse({ type: CurrentUserDto })
  me(@CurrentUser() user: unknown) {
    return user;
  }

  // ── Google OAuth ──────────────────────────────────────────────────────────

  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Initiate Google OAuth flow' })
  @ApiExcludeEndpoint()
  googleAuth() {
    // Guard redirects to Google
  }

  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiExcludeEndpoint()
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const tokens = req.user as { accessToken: string; refreshToken: string };
    const fe = this.config.get('FRONTEND_URL');
    const code = await this.authService.storeOAuthCode(tokens);
    res.redirect(`${fe}/callback?code=${code}`);
  }

  // ── GitHub OAuth ──────────────────────────────────────────────────────────

  @Public()
  @Get('github')
  @UseGuards(AuthGuard('github'))
  @ApiOperation({ summary: 'Initiate GitHub OAuth flow' })
  @ApiExcludeEndpoint()
  githubAuth() {
    // Guard redirects to GitHub
  }

  @Public()
  @Get('github/callback')
  @UseGuards(AuthGuard('github'))
  @ApiExcludeEndpoint()
  async githubCallback(@Req() req: Request, @Res() res: Response) {
    const tokens = req.user as { accessToken: string; refreshToken: string };
    const fe = this.config.get('FRONTEND_URL');
    const code = await this.authService.storeOAuthCode(tokens);
    res.redirect(`${fe}/callback?code=${code}`);
  }
}
