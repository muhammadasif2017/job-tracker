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
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { ExchangeCodeDto } from './dto/exchange-code.dto.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

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
  @Post('register')
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
  login(@Req() req: Request) {
    const user = req.user as { id: string; email: string };
    return this.authService.login(user.id, user.email);
  }

  @Public()
  @UseGuards(AuthGuard('jwt-refresh'))
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
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
  @HttpCode(HttpStatus.OK)
  @Post('exchange-code')
  exchangeCode(@Body() dto: ExchangeCodeDto) {
    return this.authService.exchangeOAuthCode(dto.code);
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout(@CurrentUser() user: { id: string }) {
    return this.authService.logout(user.id);
  }

  @Get('me')
  me(@CurrentUser() user: unknown) {
    return user;
  }

  // ── Google OAuth ──────────────────────────────────────────────────────────

  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth() {
    // Guard redirects to Google
  }

  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
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
  githubAuth() {
    // Guard redirects to GitHub
  }

  @Public()
  @Get('github/callback')
  @UseGuards(AuthGuard('github'))
  githubCallback(@Req() req: Request, @Res() res: Response) {
    const tokens = req.user as { accessToken: string; refreshToken: string };
    const fe = this.config.get('FRONTEND_URL');
    const code = this.authService.storeOAuthCode(tokens);
    res.redirect(`${fe}/callback?code=${code}`);
  }
}
