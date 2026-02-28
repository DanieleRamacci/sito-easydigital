import { CurrencyPipe, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { PaymentFormComponent } from '../../../shared/payment-form.component';

@Component({
  selector: 'app-debt-list',
  standalone: true,
  imports: [NgIf, NgFor, DatePipe, CurrencyPipe, ReactiveFormsModule, RouterLink, PaymentFormComponent],
  template: `
    <h1>Debiti clienti</h1>

    <section class="card">
      <form class="filter-grid" [formGroup]="filters" (ngSubmit)="reload()">
        <input formControlName="q" placeholder="Cerca cliente/lavoro/servizio" />
        <select formControlName="paymentStatus">
          <option value="">Stato pagamento: tutti</option>
          <option value="pending">In attesa</option>
          <option value="paid">Pagato</option>
        </select>
        <button type="submit">Filtra</button>
      </form>

      <table class="tbl" *ngIf="debts.length; else noRows">
        <thead><tr><th>Cliente</th><th>Voce</th><th>Scadenza</th><th>Totale</th><th>Pagato</th><th>Azione</th></tr></thead>
        <tbody>
          <tr *ngFor="let row of debts">
            <td>{{ row.customer?.company || row.customer?.email }}</td>
            <td>
              <a *ngIf="row.sourceType === 'job'" [routerLink]="['/gestionale/lavori', row.sourceId]">{{ row.label || row.job?.title }}</a>
              <a *ngIf="row.sourceType === 'subscription'" [routerLink]="['/gestionale/abbonamenti', row.sourceId]">{{ row.label || row.subscription?.service?.name }}</a>
            </td>
            <td>{{ row.dueDate | date: 'dd/MM/yyyy' }}</td>
            <td>{{ row.amountTotal | currency: 'EUR' }}</td>
            <td>{{ row.amountPaid | currency: 'EUR' }}</td>
            <td><app-payment-form (saved)="addPayment(row.id, $event)" /></td>
          </tr>
        </tbody>
      </table>
      <ng-template #noRows><p>Nessun debito aperto.</p></ng-template>
    </section>
  `,
})
export class DebtListComponent implements OnInit {
  debts: any[] = [];

  readonly filters = this.fb.group({
    q: [''],
    paymentStatus: ['pending'],
  });

  constructor(
    private readonly fb: FormBuilder,
    private readonly api: ApiService,
  ) {}

  async ngOnInit() {
    await this.reload();
  }

  async reload() {
    const { q, paymentStatus } = this.filters.getRawValue();
    this.debts = await firstValueFrom(
      this.api.get<any[]>('/api/debts', {
        q: q || undefined,
        paymentStatus: paymentStatus || undefined,
      }),
    );
  }

  async addPayment(id: string, payload: { amount: number; note: string }) {
    await firstValueFrom(this.api.post(`/api/debts/${id}/payments`, payload));
    await this.reload();
  }
}
