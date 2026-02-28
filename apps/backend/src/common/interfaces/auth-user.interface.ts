import type { Request } from 'express';

export interface AuthUser {
  wpUserId: string;
  email: string;
  roles: string[];
  displayName: string;
  username?: string;
}

export interface RequestWithUser extends Request {
  user?: AuthUser;
}
