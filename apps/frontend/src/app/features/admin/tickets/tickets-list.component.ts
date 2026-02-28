import { DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

@Component({
  selector: 'app-tickets-list',
  standalone: true,
  imports: [NgIf, NgFor, DatePipe, ReactiveFormsModule],
  template: `
    <h1>Lista ticket</h1>

    <section class="card">
      <table class="tbl" *ngIf="tickets.length; else noRows">
        <thead><tr><th>Cliente</th><th>Oggetto</th><th>Messaggio</th><th>Stato</th><th>Data</th><th>Azione</th></tr></thead>
        <tbody>
          <tr *ngFor="let ticket of tickets">
            <td>{{ ticket.customer?.company || ticket.email || '-' }}</td>
            <td>{{ ticket.subject }}</td>
            <td>{{ ticket.message }}</td>
            <td>{{ ticket.status }}</td>
            <td>{{ ticket.createdAt | date: 'dd/MM/yyyy HH:mm' }}</td>
            <td>
              <form class="inline-actions" [formGroup]="statusForms[ticket.id]" (ngSubmit)="saveStatus(ticket.id)">
                <select formControlName="status">
                  <option value="open">open</option>
                  <option value="in_progress">in_progress</option>
                  <option value="closed">closed</option>
                </select>
                <button type="submit">Aggiorna</button>
              </form>
            </td>
          </tr>
        </tbody>
      </table>
      <ng-template #noRows><p>Nessun ticket.</p></ng-template>
    </section>
  `,
})
export class TicketsListComponent implements OnInit {
  tickets: any[] = [];
  statusForms: Record<string, any> = {};

  constructor(
    private readonly fb: FormBuilder,
    private readonly api: ApiService,
  ) {}

  async ngOnInit() {
    await this.reload();
  }

  async reload() {
    this.tickets = await firstValueFrom(this.api.get<any[]>('/api/tickets'));
    this.statusForms = {};
    for (const ticket of this.tickets) {
      this.statusForms[ticket.id] = this.fb.group({ status: [ticket.status] });
    }
  }

  async saveStatus(ticketId: string) {
    const payload = this.statusForms[ticketId].getRawValue();
    await firstValueFrom(this.api.patch(`/api/tickets/${ticketId}/status`, payload));
    await this.reload();
  }
}
