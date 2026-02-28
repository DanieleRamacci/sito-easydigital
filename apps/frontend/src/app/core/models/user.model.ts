export interface SessionUser {
  wpUserId: string;
  email: string;
  roles: string[];
  displayName: string;
  username?: string;
}
