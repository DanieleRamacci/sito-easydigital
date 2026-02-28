import { AsyncPipe, CurrencyPipe, DatePipe, JsonPipe, NgFor, NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { TicketFormComponent } from '../../shared/ticket-form.component';

@Component({
  selector: 'app-area-dashboard',
  standalone: true,
  imports: [NgIf, NgFor, DatePipe, CurrencyPipe, JsonPipe, TicketFormComponent, AsyncPipe],
  template: `
    <h1>Area Personale</h1>
    <p>Qui trovi i tuoi servizi, rinnovi e ticket.</p>

    <section class="card" *ngIf="data?.customer; else missingCustomer">
      <h2>Dati cliente</h2>
      <p><strong>{{ data.customer.company || (data.customer.firstName + ' ' + data.customer.lastName) }}</strong></p>
      <p class="muted">{{ data.customer.email }} - {{ data.customer.phone }}</p>
    </section>

    <ng-template #missingCustomer>
      <section class="card"><p>La tua anagrafica cliente non e ancora collegata. Contattaci per assistenza.</p></section>
    </ng-template>

    <section class="card">
      <h2>Servizi attivi / storico</h2>
      <table class="tbl" *ngIf="data?.subscriptions?.length; else noSubs">
        <thead>
          <tr><th>Servizio</th><th>Tipo</th><th>Rinnovo</th><th>Prezzo</th><th>Stato</th></tr>
        </thead>
        <tbody>
          <tr *ngFor="let sub of data.subscriptions">
            <td>{{ sub.service?.name }}</td>
            <td>{{ sub.billingType }}</td>
            <td>{{ sub.renewalDate | date: 'dd/MM/yyyy' }}</td>
            <td>{{ sub.priceAtSale | currency: 'EUR' }}</td>
            <td>{{ sub.status }}</td>
          </tr>
        </tbody>
      </table>
      <ng-template #noSubs><p>Nessun servizio associato.</p></ng-template>
    </section>

    <section class="card">
      <h2>Apri ticket</h2>
      <app-ticket-form (saved)="createTicket($event)" />
    </section>

    <section class="card">
      <h2>I tuoi ticket</h2>
      <table class="tbl" *ngIf="data?.tickets?.length; else noTicket">
        <thead><tr><th>Oggetto</th><th>Stato</th><th>Data</th></tr></thead>
        <tbody>
          <tr *ngFor="let ticket of data.tickets">
            <td>{{ ticket.subject }}</td>
            <td>{{ ticket.status }}</td>
            <td>{{ ticket.createdAt | date: 'dd/MM/yyyy' }}</td>
          </tr>
        </tbody>
      </table>
      <ng-template #noTicket><p>Nessun ticket ancora aperto.</p></ng-template>
    </section>
  `,
})
export class AreaDashboardComponent implements OnInit {
  data: any;

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    await this.reload();
  }

  async createTicket(payload: { subject: string; message: string }) {
    await firstValueFrom(this.api.post('/api/area/tickets', payload));
    await this.reload();
  }

  private async reload() {
    this.data = await firstValueFrom(this.api.get('/api/area/dashboard'));
  }
}
