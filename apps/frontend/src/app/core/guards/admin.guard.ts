import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStateService } from '../services/auth-state.service';

export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthStateService);
  const router = inject(Router);

  const user = await auth.ensureLoaded();
  if (user && auth.isAdmin(user)) return true;

  if (user) {
    return router.parseUrl('/areapersonale');
  }

  return router.parseUrl('/');
};
