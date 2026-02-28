import { NgFor, NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

@Component({
  selector: 'app-customers-list',
  standalone: true,
  imports: [NgIf, NgFor, RouterLink, ReactiveFormsModule],
  template: `
    <h1>Clienti</h1>

    <section class="card row-between">
      <p>Gestisci anagrafiche, inviti, servizi e storico rinnovi.</p>
      <a class="btn-link" routerLink="/gestionale/clienti/new">+ Aggiungi cliente</a>
    </section>

    <section class="card">
      <h2>Tabella clienti</h2>
      <form class="filter-grid" [formGroup]="filters" (ngSubmit)="reload()">
        <input formControlName="q" placeholder="Cerca azienda/referente/email/telefono" />
        <select formControlName="status">
          <option value="">Tutti gli stati</option>
          <option value="active">active</option>
          <option value="invited">invited</option>
          <option value="lead">lead</option>
        </select>
        <button type="submit">Filtra</button>
      </form>

      <table class="tbl" *ngIf="customers.length; else noRows">
        <thead>
          <tr><th>Azienda</th><th>Referente</th><th>Email</th><th>Stato</th><th>Invito</th><th>Azioni</th></tr>
        </thead>
        <tbody>
          <tr *ngFor="let customer of customers">
            <td><a [routerLink]="['/gestionale/clienti', customer.id]">{{ customer.company || '-' }}</a></td>
            <td>{{ customer.firstName }} {{ customer.lastName }}</td>
            <td>{{ customer.email }}</td>
            <td>{{ customer.status }}</td>
            <td>
              <span *ngIf="customer.invites?.length">{{ customer.invites[0].token }}</span>
              <span *ngIf="!customer.invites?.length">-</span>
            </td>
            <td>
              <a class="btn-link" [routerLink]="['/gestionale/clienti', customer.id]">Apri</a>
            </td>
          </tr>
        </tbody>
      </table>
      <ng-template #noRows><p>Nessun cliente.</p></ng-template>
    </section>
  `,
})
export class CustomersListComponent implements OnInit {
  customers: any[] = [];

  readonly filters = this.fb.group({
    q: [''],
    status: [''],
  });

  constructor(
    private readonly fb: FormBuilder,
    private readonly api: ApiService,
  ) {}

  async ngOnInit() {
    await this.reload();
  }

  async reload() {
    const { q, status } = this.filters.getRawValue();
    this.customers = await firstValueFrom(
      this.api.get<any[]>('/api/customers', {
        q: q || undefined,
        status: status || undefined,
      }),
    );
  }
}
