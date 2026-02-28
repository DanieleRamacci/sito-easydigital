import { Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { JwtSessionService } from './jwt-session.service';

@Controller('api')
export class AuthController {
  private readonly appBaseUrl = (process.env.APP_BASE_URL ?? 'http://localhost:4200').replace(/\/+$/, '');
  private readonly sessionMaxAgeMs = 60 * 60 * 1000;

  constructor(private readonly jwtSessionService: JwtSessionService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Get('login-url')
  loginUrl() {
    return {
      wpLoginUrl: process.env.WP_LOGIN_URL ?? '',
    };
  }

  @Get('auth/callback')
  authCallback(@Query('token') token: string | undefined, @Query('next') next: string | undefined, @Res() response: Response) {
    const redirectPath = this.sanitizeNext(next);
    const redirectUrl = `${this.appBaseUrl}${redirectPath}`;

    if (!token) {
      return response.redirect(`${this.appBaseUrl}/`);
    }

    try {
      this.jwtSessionService.verifyToken(token);
    } catch {
      response.clearCookie('eda_mgr_session', {
        httpOnly: true,
        path: '/',
        domain: this.cookieDomain,
      });
      return response.redirect(`${this.appBaseUrl}/`);
    }

    response.cookie('eda_mgr_session', token, {
      httpOnly: true,
      secure: this.appBaseUrl.startsWith('https://'),
      sameSite: 'lax',
      path: '/',
      maxAge: this.sessionMaxAgeMs,
      domain: this.cookieDomain,
    });

    return response.redirect(redirectUrl);
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('eda_mgr_session', {
      httpOnly: true,
      path: '/',
      domain: this.cookieDomain,
    });
    return { ok: true };
  }

  private sanitizeNext(next: string | undefined) {
    if (typeof next !== 'string') return '/areapersonale';
    return /^\/(gestionale|areapersonale)(\/.*)?$/.test(next) ? next : '/areapersonale';
  }

  private get cookieDomain() {
    const domain = (process.env.COOKIE_DOMAIN ?? '').trim();
    if (!domain || domain === 'localhost') return undefined;
    return domain;
  }
}
