import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import { AuthService } from '../auth.service.js';

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

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: (err: any, user: any) => void,
  ) {
    const { id, emails, displayName, username, photos } = profile;
    const email = emails?.[0]?.value;
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
