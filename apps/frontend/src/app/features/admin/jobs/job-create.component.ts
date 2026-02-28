import { NgFor } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { JobFormComponent } from '../../../shared/job-form.component';

@Component({
  selector: 'app-job-create',
  standalone: true,
  imports: [NgFor, ReactiveFormsModule, RouterLink, JobFormComponent],
  template: `
    <h1>Nuova attivita</h1>

    <section class="card">
      <h2>Cliente</h2>
      <form class="inline-actions" [formGroup]="customerForm">
        <select formControlName="customerId">
          <option value="">Seleziona cliente</option>
          <option *ngFor="let customer of customers" [value]="customer.id">
            {{ customer.company || customer.email }}
          </option>
        </select>
        <a class="btn-link" routerLink="/gestionale/clienti/new">Aggiungi cliente</a>
      </form>
    </section>

    <section class="card">
      <h2>Dati attivita</h2>
      <app-job-form [services]="services" (saved)="save($event)" />
    </section>
  `,
})
export class JobCreateComponent implements OnInit {
  customers: any[] = [];
  services: any[] = [];

  readonly customerForm = this.fb.group({
    customerId: ['', Validators.required],
  });

  constructor(
    private readonly fb: FormBuilder,
    private readonly api: ApiService,
    private readonly router: Router,
  ) {}

  async ngOnInit() {
    const [customers, services] = await Promise.all([
      firstValueFrom(this.api.get<any[]>('/api/customers')),
      firstValueFrom(this.api.get<any[]>('/api/services', { active: true })),
    ]);

    this.customers = customers;
    this.services = services;
  }

  async save(payload: any) {
    if (this.customerForm.invalid) return;

    const customerId = this.customerForm.getRawValue().customerId;
    const created = await firstValueFrom(this.api.post<any>('/api/jobs', { ...payload, customerId }));
    await this.router.navigate(['/gestionale/lavori', created.id]);
  }
}
