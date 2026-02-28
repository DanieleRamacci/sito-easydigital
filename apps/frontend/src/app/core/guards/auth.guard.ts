import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStateService } from '../services/auth-state.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthStateService);
  const router = inject(Router);

  const user = await auth.ensureLoaded();
  if (user) return true;

  return router.parseUrl('/');
};
