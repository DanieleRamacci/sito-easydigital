import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStateService } from '../../core/services/auth-state.service';

@Component({
  selector: 'app-logout',
  standalone: true,
  template: `<div class="shell"><main class="card"><p>Logout in corso...</p></main></div>`,
})
export class LogoutComponent implements OnInit {
  constructor(
    private readonly auth: AuthStateService,
    private readonly router: Router,
  ) {}

  async ngOnInit() {
    await this.auth.logout();
    await this.router.navigateByUrl('/');
  }
}
