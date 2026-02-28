import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { JwtSessionService } from '../../modules/auth/jwt-session.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtSessionService: JwtSessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const token = request.cookies?.eda_mgr_session as string | undefined;

    if (!token) {
      throw new UnauthorizedException('Not authenticated');
    }

    request.user = this.jwtSessionService.verifyToken(token);
    return true;
  }
}
