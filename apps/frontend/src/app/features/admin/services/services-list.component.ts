import { CurrencyPipe, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ServiceFormComponent } from '../../../shared/service-form.component';

@Component({
  selector: 'app-services-list',
  standalone: true,
  imports: [NgIf, NgFor, CurrencyPipe, DatePipe, ReactiveFormsModule, ServiceFormComponent],
  template: `
    <h1>Gestione Servizi</h1>

    <section class="card">
      <h2>Nuovo servizio</h2>
      <app-service-form (saved)="create($event)" />
    </section>

    <section class="card">
      <h2>Catalogo servizi</h2>
      <table class="tbl" *ngIf="services.length; else noServices">
        <thead><tr><th>Nome</th><th>Prezzo</th><th>Billing</th><th>Storico prezzo</th><th>Azione</th></tr></thead>
        <tbody>
          <tr *ngFor="let service of services">
            <td>{{ service.name }}</td>
            <td>{{ service.price | currency: 'EUR' }}</td>
            <td>{{ service.billingType }} {{ service.billingInterval || '' }}</td>
            <td>
              <div *ngFor="let h of service.priceHistory?.slice(0, 3)">
                {{ h.changedAt | date: 'dd/MM/yyyy' }}: {{ h.oldPrice | currency: 'EUR' }} -> {{ h.newPrice | currency: 'EUR' }}
              </div>
            </td>
            <td>
              <form class="inline-actions" [formGroup]="priceForms[service.id]" (ngSubmit)="updatePrice(service.id)">
                <input formControlName="price" type="number" step="0.01" />
                <input formControlName="note" placeholder="Nota" />
                <button type="submit">Aggiorna</button>
              </form>
            </td>
          </tr>
        </tbody>
      </table>
      <ng-template #noServices><p>Nessun servizio presente.</p></ng-template>
    </section>
  `,
})
export class ServicesListComponent implements OnInit {
  services: any[] = [];
  priceForms: Record<string, any> = {};

  constructor(
    private readonly api: ApiService,
    private readonly fb: FormBuilder,
  ) {}

  async ngOnInit() {
    await this.reload();
  }

  async create(payload: any) {
    await firstValueFrom(this.api.post('/api/services', payload));
    await this.reload();
  }

  async updatePrice(serviceId: string) {
    const form = this.priceForms[serviceId];
    await firstValueFrom(this.api.post(`/api/services/${serviceId}/price`, form.getRawValue()));
    await this.reload();
  }

  private async reload() {
    this.services = await firstValueFrom(this.api.get<any[]>('/api/services'));
    this.priceForms = {};
    for (const service of this.services) {
      this.priceForms[service.id] = this.fb.group({
        price: [service.price],
        note: [''],
      });
    }
  }
}
