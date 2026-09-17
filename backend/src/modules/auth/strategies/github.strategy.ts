import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import { AuthService } from '../auth.service.js';

/**
 * GitHub OAuth login strategy (`github`). Missing client credentials fall back
 * to `'placeholder'` so the app still boots without GitHub configured; only
 * this login route fails.
 */
@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(
    config: ConfigService,
    private authService: AuthService,
  ) {
    super({
      clientID: config.get<string>('GITHUB_CLIENT_ID') ?? 'placeholder',
      clientSecret: config.get<string>('GITHUB_CLIENT_SECRET') ?? 'placeholder',
      callbackURL: `${config.get<string>('BACKEND_URL') ?? 'http://localhost:3001'}/auth/github/callback`,
      scope: ['user:email'],
    });
  }

  /**
   * Signs in or creates the user for a GitHub profile and hands the issued
   * tokens to the callback route as `request.user`. A profile without an
   * email is rejected: a first sign-in links to an existing account, or
   * creates one, by email.
   */
  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: (err: any, user: any) => void,
  ) {
    const { id, emails, displayName, username, photos } = profile;
    const email = emails?.[0]?.value;
    if (!email)
      return done(new Error('GitHub account has no verified email'), null);
    const avatarUrl = photos?.[0]?.value;
    const name = displayName || username;

    const tokens = await this.authService.handleOAuthUser(
      'github',
      String(id),
      email,
      name,
      avatarUrl,
    );

    done(null, tokens);
  }
}
