import { DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { JobFormComponent } from '../../../shared/job-form.component';
import { PaymentFormComponent } from '../../../shared/payment-form.component';

@Component({
  selector: 'app-job-detail',
  standalone: true,
  imports: [NgIf, NgFor, DatePipe, ReactiveFormsModule, RouterLink, JobFormComponent, PaymentFormComponent],
  template: `
    <h1>Scheda Attivita</h1>

    <section class="card" *ngIf="job">
      <div class="row-between">
        <a class="btn-link" routerLink="/gestionale/lavori">← Attivita</a>
        <div class="inline-actions">
          <a class="btn-link" *ngIf="job.customer" [routerLink]="['/gestionale/clienti', job.customer.id]">Apri cliente</a>
          <button class="danger-btn ghost" (click)="remove()">Elimina attivita</button>
        </div>
      </div>
    </section>

    <section class="card" *ngIf="job">
      <h2>Dati job + update</h2>
      <app-job-form [value]="job" [services]="services" (saved)="update($event)" />
    </section>

    <section class="card" *ngIf="job">
      <h2>Cambio stato</h2>
      <form class="inline-actions" [formGroup]="statusForm" (ngSubmit)="updateStatus()">
        <input formControlName="status" placeholder="Nuovo stato" />
        <button type="submit">Aggiorna stato</button>
      </form>
    </section>

    <section class="card" *ngIf="job">
      <h2>Note</h2>
      <form class="form-grid" [formGroup]="noteForm" (ngSubmit)="addNote()">
        <textarea formControlName="text" rows="3" placeholder="Aggiungi nota"></textarea>
        <button type="submit">Aggiungi</button>
      </form>
      <div class="crm-notes-list">
        <div class="crm-note" *ngFor="let note of job.notes">
          <div>{{ note.text }}</div>
          <small class="muted">{{ note.createdAt | date: 'dd/MM/yyyy HH:mm' }}</small>
        </div>
      </div>
    </section>

    <section class="card" *ngIf="job?.debtItem">
      <h2>Payment</h2>
      <p>Totale: {{ job.debtItem.amountTotal }} - Pagato: {{ job.debtItem.amountPaid }}</p>
      <app-payment-form (saved)="addPayment(job.debtItem.id, $event)" />
    </section>
  `,
})
export class JobDetailComponent implements OnInit {
  jobId = '';
  job: any;
  services: any[] = [];

  readonly noteForm = this.fb.group({
    text: ['', Validators.required],
  });

  readonly statusForm = this.fb.group({
    status: [''],
  });

  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: ApiService,
    private readonly fb: FormBuilder,
  ) {}

  async ngOnInit() {
    this.jobId = String(this.route.snapshot.paramMap.get('id'));
    this.services = await firstValueFrom(this.api.get<any[]>('/api/services', { active: true }));
    await this.reload();
  }

  async reload() {
    this.job = await firstValueFrom(this.api.get<any>(`/api/jobs/${this.jobId}`));
    this.statusForm.patchValue({ status: this.job.status || '' });
  }

  async update(payload: any) {
    await firstValueFrom(this.api.patch(`/api/jobs/${this.jobId}`, { ...payload, customerId: this.job.customerId }));
    await this.reload();
  }

  async addNote() {
    if (this.noteForm.invalid) return;
    await firstValueFrom(this.api.post(`/api/jobs/${this.jobId}/notes`, this.noteForm.getRawValue()));
    this.noteForm.reset();
    await this.reload();
  }

  async updateStatus() {
    await firstValueFrom(this.api.post(`/api/jobs/${this.jobId}/status`, this.statusForm.getRawValue()));
    await this.reload();
  }

  async addPayment(debtId: string, payload: { amount: number; note: string }) {
    await firstValueFrom(this.api.post(`/api/debts/${debtId}/payments`, payload));
    await this.reload();
  }

  async remove() {
    await firstValueFrom(this.api.delete(`/api/jobs/${this.jobId}`));
    window.location.href = '/gestionale/lavori';
  }
}
