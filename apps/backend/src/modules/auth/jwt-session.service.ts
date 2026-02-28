import { Injectable, UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';

interface JwtPayload {
  sub?: string | number;
  email?: string;
  roles?: string[] | string;
  display_name?: string;
  name?: string;
  username?: string;
}

@Injectable()
export class JwtSessionService {
  private readonly secret = process.env.JWT_SECRET;
  private readonly publicKey = process.env.JWT_PUBLIC_KEY?.replace(/\\n/g, '\n');

  verifyToken(token: string): AuthUser {
    if (!token) {
      throw new UnauthorizedException('Missing session cookie');
    }

    const verificationKey = this.publicKey || this.secret;
    if (!verificationKey) {
      throw new UnauthorizedException('JWT verifier is not configured');
    }

    let payload: JwtPayload;

    try {
      payload = jwt.verify(token, verificationKey, {
        algorithms: this.publicKey ? ['RS256', 'RS384', 'RS512'] : ['HS256', 'HS384', 'HS512'],
      }) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid session token');
    }

    const roles = Array.isArray(payload.roles)
      ? payload.roles.map((v) => String(v))
      : payload.roles
        ? [String(payload.roles)]
        : [];

    return {
      wpUserId: String(payload.sub ?? ''),
      email: String(payload.email ?? ''),
      roles,
      displayName: String(payload.display_name ?? payload.name ?? payload.email ?? 'Utente'),
      username: payload.username,
    };
  }
}
