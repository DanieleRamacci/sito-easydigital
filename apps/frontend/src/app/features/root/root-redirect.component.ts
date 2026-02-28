import { NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStateService } from '../../core/services/auth-state.service';

@Component({
  selector: 'app-root-redirect',
  standalone: true,
  imports: [NgIf],
  template: `
    <div class="shell">
      <main class="card" *ngIf="!loading">
        <h1>Easy Digital - Gestionale</h1>
        <p *ngIf="!user">Accedi al portale tramite WordPress SSO.</p>
        <p *ngIf="!user && !loginUrl">Login WordPress non configurato (WP_LOGIN_URL).</p>
        <button *ngIf="!user && loginUrl" (click)="goToLogin()">Vai al login WordPress</button>
      </main>
      <main class="card" *ngIf="loading"><p>Verifica sessione in corso...</p></main>
    </div>
  `,
})
export class RootRedirectComponent implements OnInit {
  loading = true;
  user = this.auth.snapshot;
  loginUrl = '';

  constructor(
    private readonly auth: AuthStateService,
    private readonly router: Router,
  ) {}

  async ngOnInit() {
    try {
      this.loginUrl = await this.auth.loginUrl();
    } catch {
      this.loginUrl = '';
    }

    const user = await this.auth.ensureLoaded();
    this.user = user;
    this.loading = false;

    if (!user) return;

    if (this.auth.isAdmin(user)) {
      await this.router.navigateByUrl('/gestionale');
      return;
    }

    await this.router.navigateByUrl('/areapersonale');
  }

  goToLogin() {
    window.location.href = this.loginUrl;
  }
}
