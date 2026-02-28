import { CurrencyPipe, DatePipe, NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { PaymentFormComponent } from '../../../shared/payment-form.component';
import { SubscriptionEditComponent } from '../../../shared/subscription-edit.component';

@Component({
  selector: 'app-subscription-detail',
  standalone: true,
  imports: [NgIf, DatePipe, CurrencyPipe, RouterLink, SubscriptionEditComponent, PaymentFormComponent],
  template: `
    <h1>Scheda Abbonamento</h1>

    <section class="card" *ngIf="subscription">
      <a class="btn-link" routerLink="/gestionale/rinnovi">← Debiti clienti</a>
      <a class="btn-link" *ngIf="subscription.customer" [routerLink]="['/gestionale/clienti', subscription.customer.id]">Apri cliente</a>
    </section>

    <section class="card" *ngIf="subscription">
      <h2>Dati abbonamento</h2>
      <p><strong>{{ subscription.service?.name }}</strong></p>
      <p>Prezzo corrente: {{ subscription.priceAtSale | currency: 'EUR' }}</p>
      <p>Rinnovo: {{ subscription.renewalDate | date: 'dd/MM/yyyy' }}</p>
      <p>Stato: {{ subscription.status }}</p>
      <app-subscription-edit [value]="subscription" (saved)="save($event)" />
    </section>

    <section class="card" *ngIf="subscription?.debtItem">
      <h2>Pagamento</h2>
      <p>Totale: {{ subscription.debtItem.amountTotal }} - Pagato: {{ subscription.debtItem.amountPaid }}</p>
      <app-payment-form (saved)="addPayment($event)" />
    </section>
  `,
})
export class SubscriptionDetailComponent implements OnInit {
  id = '';
  subscription: any;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: ApiService,
  ) {}

  async ngOnInit() {
    this.id = String(this.route.snapshot.paramMap.get('id'));
    await this.reload();
  }

  async reload() {
    this.subscription = await firstValueFrom(this.api.get<any>(`/api/subscriptions/${this.id}`));
  }

  async save(payload: any) {
    await firstValueFrom(this.api.patch(`/api/subscriptions/${this.id}`, payload));
    await this.reload();
  }

  async addPayment(payload: { amount: number; note: string }) {
    await firstValueFrom(this.api.post(`/api/debts/${this.subscription.debtItem.id}/payments`, payload));
    await this.reload();
  }
}
