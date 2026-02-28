import { AsyncPipe, NgIf } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthStateService } from '../core/services/auth-state.service';

@Component({
  selector: 'app-layout-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AsyncPipe, NgIf],
  template: `
    <div class="shell app-shell">
      <header class="top">
        <div>
          <strong>Easy Digital Agency - Gestionale</strong>
          <div class="muted" *ngIf="auth.user$ | async as user">
            Utente: {{ user.displayName }} ({{ user.roles.join(', ') }})
          </div>
        </div>
      </header>

      <div class="app-body has-sidebar">
        <aside class="side-nav">
          <h3>Navigazione</h3>
          <a routerLink="/gestionale" routerLinkActive="is-active" [routerLinkActiveOptions]="{ exact: true }">Dashboard</a>
          <a routerLink="/gestionale/lavori" routerLinkActive="is-active">Attivita</a>
          <a routerLink="/gestionale/servizi" routerLinkActive="is-active">Servizi</a>
          <a routerLink="/gestionale/rinnovi" routerLinkActive="is-active">Rinnovi</a>
          <a routerLink="/gestionale/debiti" routerLinkActive="is-active">Debiti clienti</a>
          <a routerLink="/gestionale/importazioni" routerLinkActive="is-active">Importazioni</a>
          <a routerLink="/gestionale/clienti" routerLinkActive="is-active">Clienti</a>
          <a routerLink="/gestionale/ticket" routerLinkActive="is-active">Ticket</a>
          <a routerLink="/areapersonale" routerLinkActive="is-active">Area personale</a>
          <a routerLink="/logout">Logout</a>
        </aside>

        <main class="app-main">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
})
export class LayoutShellComponent {
  constructor(public readonly auth: AuthStateService) {}
}
