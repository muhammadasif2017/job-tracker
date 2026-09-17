import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { AuthService } from '../auth.service.js';

/**
 * Google OAuth login strategy (`google`). Missing client credentials fall back
 * to `'placeholder'` so the app still boots without Google configured; only
 * this login route fails.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    config: ConfigService,
    private authService: AuthService,
  ) {
    super({
      clientID: config.get<string>('GOOGLE_CLIENT_ID') ?? 'placeholder',
      clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET') ?? 'placeholder',
      callbackURL: `${config.get<string>('BACKEND_URL') ?? 'http://localhost:3001'}/auth/google/callback`,
      scope: ['email', 'profile'],
    });
  }

  /**
   * Signs in or creates the user for a Google profile and hands the issued
   * tokens to the callback route as `request.user`. A profile without an
   * email is rejected: a first sign-in links to an existing account, or
   * creates one, by email.
   */
  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ) {
    const { id, emails, displayName, photos } = profile;
    const email = emails?.[0]?.value;
    if (!email) return done(new Error('Google account has no email'), false);
    const avatarUrl = photos?.[0]?.value;

    const tokens = await this.authService.handleOAuthUser(
      'google',
      id,
      email,
      displayName,
      avatarUrl,
    );

    done(null, tokens);
  }
}
