import { CurrencyPipe, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

@Component({
  selector: 'app-renewals-list',
  standalone: true,
  imports: [NgIf, NgFor, DatePipe, CurrencyPipe, ReactiveFormsModule, RouterLink],
  template: `
    <h1>Debiti clienti e rinnovi</h1>

    <section class="card">
      <form class="filter-grid" [formGroup]="filters" (ngSubmit)="reload()">
        <input formControlName="q" placeholder="Cerca cliente/servizio" />
        <select formControlName="status">
          <option value="">Tutti</option>
          <option value="active">active</option>
          <option value="expired">expired</option>
          <option value="cancelled">cancelled</option>
        </select>
        <button type="submit">Filtra</button>
      </form>

      <table class="tbl" *ngIf="rows.length; else noRows">
        <thead><tr><th>Cliente</th><th>Servizio</th><th>Rinnovo</th><th>Prezzo</th><th>Stato</th><th></th></tr></thead>
        <tbody>
          <tr *ngFor="let row of rows">
            <td>{{ row.customer?.company || row.customer?.email }}</td>
            <td>{{ row.service?.name }}</td>
            <td>{{ row.renewalDate | date: 'dd/MM/yyyy' }}</td>
            <td>{{ row.priceAtSale | currency: 'EUR' }}</td>
            <td>{{ row.status }}</td>
            <td><a class="btn-link" [routerLink]="['/gestionale/abbonamenti', row.id]">Apri</a></td>
          </tr>
        </tbody>
      </table>
      <ng-template #noRows><p>Nessun rinnovo trovato.</p></ng-template>
    </section>
  `,
})
export class RenewalsListComponent implements OnInit {
  rows: any[] = [];

  readonly filters = this.fb.group({
    q: [''],
    status: ['active'],
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
    this.rows = await firstValueFrom(
      this.api.get<any[]>('/api/subscriptions', {
        q: q || undefined,
        status: status || undefined,
      }),
    );
  }
}
