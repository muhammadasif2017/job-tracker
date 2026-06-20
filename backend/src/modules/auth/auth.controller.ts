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
import { RefreshDto } from './dto/refresh.dto.js';
import { ExchangeCodeDto } from './dto/exchange-code.dto.js';
import { AuthTokensDto } from './dto/auth-tokens.dto.js';
import { CurrentUserDto } from './dto/current-user.dto.js';
import { MessageDto } from '../../common/dto/message.dto.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {}

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
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
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
  login(@Req() req: Request) {
    const user = req.user as { id: string; email: string };
    return this.authService.login(user.id, user.email);
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
  @ApiOperation({ summary: 'Rotate tokens using a refresh token' })
  @ApiOkResponse({ type: AuthTokensDto })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired refresh token' })
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    const user = req.user as { sub: string; email: string; jti: string };
    return this.authService.refresh(
      user.sub,
      user.email,
      dto.refreshToken,
      user.jti,
    );
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
  exchangeCode(@Body() dto: ExchangeCodeDto) {
    return this.authService.exchangeOAuthCode(dto.code);
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invalidate the current refresh token' })
  @ApiOkResponse({ type: MessageDto })
  logout(@CurrentUser() user: { id: string }) {
    return this.authService.logout(user.id);
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
  googleCallback(@Req() req: Request, @Res() res: Response) {
    const tokens = req.user as { accessToken: string; refreshToken: string };
    const fe = this.config.get('FRONTEND_URL');
    const code = this.authService.storeOAuthCode(tokens);
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
  githubCallback(@Req() req: Request, @Res() res: Response) {
    const tokens = req.user as { accessToken: string; refreshToken: string };
    const fe = this.config.get('FRONTEND_URL');
    const code = this.authService.storeOAuthCode(tokens);
    res.redirect(`${fe}/callback?code=${code}`);
  }
}
