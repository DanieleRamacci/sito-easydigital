import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { JwtSessionService } from '../../modules/auth/jwt-session.service';
import type { AuthUser } from '../interfaces/auth-user.interface';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly devAuthBypassEnabled = isTruthy(process.env.DEV_AUTH_BYPASS);

  constructor(private readonly jwtSessionService: JwtSessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = request.cookies?.eda_mgr_session as string | undefined;

    if (this.devAuthBypassEnabled) {
      if (!token) {
        request.user = this.getDevUser();
        return true;
      }

      try {
        request.user = this.jwtSessionService.verifyToken(token);
        return true;
      } catch {
        request.user = this.getDevUser();
        return true;
      }
    }

    if (!token) {
      throw new UnauthorizedException('Not authenticated');
    }

    request.user = this.jwtSessionService.verifyToken(token);
    return true;
  }

  private getDevUser(): AuthUser {
    const roles = (process.env.DEV_AUTH_ROLES ?? 'administrator')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    return {
      wpUserId: process.env.DEV_AUTH_USER_ID ?? 'local-dev-user',
      email: process.env.DEV_AUTH_EMAIL ?? 'local-admin@easydigital.local',
      roles: roles.length ? roles : ['administrator'],
      displayName: process.env.DEV_AUTH_DISPLAY_NAME ?? 'Local Admin',
      username: process.env.DEV_AUTH_USERNAME ?? 'localadmin',
    };
  }
}

function isTruthy(value: string | undefined) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}
