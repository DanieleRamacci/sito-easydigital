import { AsyncPipe, NgIf } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { AuthStateService } from '../core/services/auth-state.service';

@Component({
  selector: 'app-area-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, AsyncPipe, NgIf],
  template: `
    <div class="shell app-shell">
      <header class="top">
        <div>
          <strong>Easy Digital Agency - Area Personale</strong>
          <div class="muted" *ngIf="auth.user$ | async as user">
            Ciao {{ user.displayName }}
          </div>
        </div>
        <nav class="nav">
          <a routerLink="/areapersonale">Dashboard</a>
          <a routerLink="/logout">Logout</a>
        </nav>
      </header>
      <main class="app-main">
        <router-outlet />
      </main>
    </div>
  `,
})
export class AreaLayoutComponent {
  constructor(public readonly auth: AuthStateService) {}
}
