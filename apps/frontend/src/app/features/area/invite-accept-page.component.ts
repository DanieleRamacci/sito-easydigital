import { NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

@Component({
  selector: 'app-invite-accept-page',
  standalone: true,
  imports: [ReactiveFormsModule, NgIf],
  template: `
    <div class="shell">
      <main class="card">
        <h1>Completa registrazione</h1>
        <p>Inserisci i dati minimi richiesti e conferma l'invito.</p>
        <p *ngIf="message" class="notice success">{{ message }}</p>

        <form class="form-grid two-col" [formGroup]="form" (ngSubmit)="submit()">
          <input formControlName="token" placeholder="Token invito" />
          <input formControlName="company" placeholder="Azienda" />
          <input formControlName="phone" placeholder="Telefono" />
          <input formControlName="vat" placeholder="Partita IVA" />
          <input formControlName="billingAddress" placeholder="Indirizzo fatturazione" />
          <input formControlName="pec" placeholder="PEC" />
          <input formControlName="sdi" placeholder="SDI" />
          <input formControlName="wpUserId" placeholder="WP User ID (opzionale)" />
          <input formControlName="wpUsername" placeholder="WP Username (opzionale)" />
          <button type="submit">Completa registrazione</button>
        </form>
      </main>
    </div>
  `,
})
export class InviteAcceptPageComponent implements OnInit {
  message = '';

  readonly form = this.fb.group({
    token: ['', Validators.required],
    company: [''],
    phone: [''],
    vat: [''],
    billingAddress: [''],
    pec: [''],
    sdi: [''],
    wpUserId: [''],
    wpUsername: [''],
  });

  constructor(
    private readonly fb: FormBuilder,
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    const tokenFromQuery = this.route.snapshot.queryParamMap.get('token');
    const tokenFromParam = this.route.snapshot.paramMap.get('token');
    const token = tokenFromQuery || tokenFromParam;
    if (token) this.form.patchValue({ token });
  }

  async submit() {
    if (this.form.invalid) return;

    await firstValueFrom(this.api.post('/api/invites/complete', this.form.getRawValue()));
    this.message = 'Registrazione completata. Ora puoi accedere con Login WordPress.';
  }
}
