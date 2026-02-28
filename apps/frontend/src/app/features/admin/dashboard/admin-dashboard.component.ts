import { CurrencyPipe, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [NgIf, NgFor, RouterLink, DatePipe, CurrencyPipe],
  template: `
    <h1>Gestionale - Dashboard</h1>

    <div class="kpi-grid" *ngIf="kpis">
      <article class="kpi"><div class="kpi-label">Clienti</div><div class="kpi-value">{{ kpis.customers }}</div></article>
      <article class="kpi"><div class="kpi-label">Servizi catalogo</div><div class="kpi-value">{{ kpis.services }}</div></article>
      <article class="kpi"><div class="kpi-label">Attivita aperte</div><div class="kpi-value">{{ kpis.openJobs }}</div></article>
      <article class="kpi"><div class="kpi-label">Debiti aperti</div><div class="kpi-value">{{ kpis.openDebts }}</div></article>
      <article class="kpi"><div class="kpi-label">Ticket aperti</div><div class="kpi-value">{{ kpis.openTickets }}</div></article>
    </div>

    <section class="card">
      <h2>Quick links</h2>
      <div class="dash-tabs">
        <a class="btn-link" routerLink="/gestionale/lavori/new">+ Nuova attivita</a>
        <a class="btn-link" routerLink="/gestionale/clienti/new">+ Nuovo cliente</a>
        <a class="btn-link" routerLink="/gestionale/rinnovi">Rinnovi prossimi</a>
        <a class="btn-link" routerLink="/gestionale/debiti">Debiti clienti</a>
      </div>
    </section>

    <section class="card">
      <h2>Rinnovi prossimi</h2>
      <table class="tbl" *ngIf="renewals.length; else noRenewals">
        <thead><tr><th>Cliente</th><th>Servizio</th><th>Rinnovo</th><th>Prezzo</th></tr></thead>
        <tbody>
          <tr *ngFor="let row of renewals">
            <td>{{ row.customer?.company || row.customer?.email }}</td>
            <td>{{ row.service?.name }}</td>
            <td>{{ row.renewalDate | date: 'dd/MM/yyyy' }}</td>
            <td>{{ row.priceAtSale | currency: 'EUR' }}</td>
          </tr>
        </tbody>
      </table>
      <ng-template #noRenewals><p>Nessun rinnovo in vista.</p></ng-template>
    </section>

    <section class="card">
      <h2>Ultimi ticket</h2>
      <table class="tbl" *ngIf="tickets.length; else noTickets">
        <thead><tr><th>Oggetto</th><th>Stato</th><th>Data</th></tr></thead>
        <tbody>
          <tr *ngFor="let ticket of tickets">
            <td>{{ ticket.subject }}</td>
            <td>{{ ticket.status }}</td>
            <td>{{ ticket.createdAt | date: 'dd/MM/yyyy' }}</td>
          </tr>
        </tbody>
      </table>
      <ng-template #noTickets><p>Nessun ticket.</p></ng-template>
    </section>
  `,
})
export class AdminDashboardComponent implements OnInit {
  kpis: any;
  renewals: any[] = [];
  tickets: any[] = [];

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    const [customers, services, jobs, debts, tickets, renewals] = await Promise.all([
      firstValueFrom(this.api.get<any[]>('/api/customers')),
      firstValueFrom(this.api.get<any[]>('/api/services')),
      firstValueFrom(this.api.get<any[]>('/api/jobs')),
      firstValueFrom(this.api.get<any[]>('/api/debts')),
      firstValueFrom(this.api.get<any[]>('/api/tickets')),
      firstValueFrom(this.api.get<any[]>('/api/subscriptions', { status: 'active' })),
    ]);

    this.tickets = tickets.slice(0, 8);
    this.renewals = renewals.filter((s) => s.billingType === 'subscription').slice(0, 10);

    this.kpis = {
      customers: customers.length,
      services: services.length,
      openJobs: jobs.filter((job) => !String(job.status || '').startsWith('chiusa_')).length,
      openDebts: debts.filter((debt) => debt.paymentStatus !== 'paid').length,
      openTickets: tickets.filter((ticket) => ticket.status !== 'closed').length,
    };
  }
}
