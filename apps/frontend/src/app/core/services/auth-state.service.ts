import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import type { SessionUser } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class AuthStateService {
  private readonly userSubject = new BehaviorSubject<SessionUser | null>(null);
  private readonly loadingSubject = new BehaviorSubject<boolean>(true);
  private initialized = false;

  user$ = this.userSubject.asObservable();
  loading$ = this.loadingSubject.asObservable();

  constructor(private readonly api: ApiService) {}

  get snapshot() {
    return this.userSubject.value;
  }

  async ensureLoaded(): Promise<SessionUser | null> {
    if (this.initialized) return this.snapshot;
    this.initialized = true;

    try {
      const user = await firstValueFrom(this.api.get<SessionUser>('/api/me'));
      this.userSubject.next(user);
      return user;
    } catch {
      this.userSubject.next(null);
      return null;
    } finally {
      this.loadingSubject.next(false);
    }
  }

  isAdmin(user = this.snapshot): boolean {
    return !!user?.roles?.includes('administrator');
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.api.post('/api/logout', {}));
    } finally {
      this.userSubject.next(null);
    }
  }

  async loginUrl(): Promise<string> {
    const result = await firstValueFrom(this.api.get<{ wpLoginUrl: string }>('/api/login-url'));
    return result.wpLoginUrl;
  }
}
