import { DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { CustomerFormComponent } from '../../../shared/customer-form.component';
import { PaymentFormComponent } from '../../../shared/payment-form.component';

@Component({
  selector: 'app-customer-detail',
  standalone: true,
  imports: [NgIf, NgFor, DatePipe, RouterLink, ReactiveFormsModule, CustomerFormComponent, PaymentFormComponent],
  template: `
    <h1>Gestionale - Dettaglio Cliente</h1>

    <section class="card" *ngIf="customer">
      <div class="row-between">
        <a class="btn-link" routerLink="/gestionale/clienti">← Clienti</a>
        <button class="danger-btn ghost" (click)="deleteCustomer()">Elimina cliente</button>
      </div>
    </section>

    <section class="card" *ngIf="customer">
      <h2>Dati cliente + update</h2>
      <app-customer-form [value]="customer" (saved)="updateCustomer($event)" />
    </section>

    <section class="card" *ngIf="customer">
      <h2>Notes</h2>
      <form class="form-grid" [formGroup]="noteForm" (ngSubmit)="addNote()">
        <textarea formControlName="text" rows="3" placeholder="Nuova nota"></textarea>
        <button type="submit">Aggiungi nota</button>
      </form>
      <div class="crm-notes-list">
        <div class="crm-note" *ngFor="let note of customer.notes">
          <div>{{ note.text }}</div>
          <div class="muted">{{ note.createdAt | date: 'dd/MM/yyyy HH:mm' }}</div>
        </div>
      </div>
    </section>

    <section class="card" *ngIf="customer">
      <h2>Contacts</h2>
      <form class="form-grid two-col" [formGroup]="contactForm" (ngSubmit)="addContact()">
        <input formControlName="name" placeholder="Nome" />
        <input formControlName="email" placeholder="Email" />
        <input formControlName="phone" placeholder="Telefono" />
        <input formControlName="role" placeholder="Ruolo" />
        <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" formControlName="isPrimary" /> Primario</label>
        <button type="submit">Aggiungi contatto</button>
      </form>
      <ul class="contact-list">
        <li class="contact-item" *ngFor="let contact of customer.contacts">
          <span>{{ contact.name }} - {{ contact.email }} - {{ contact.phone }}</span>
          <button class="danger-btn ghost" (click)="deleteContact(contact.id)">Elimina</button>
        </li>
      </ul>
    </section>

    <section class="card" *ngIf="customer">
      <h2>Pagamenti</h2>
      <table class="tbl" *ngIf="customer.debtItems?.length; else noDebts">
        <thead><tr><th>Voce</th><th>Totale</th><th>Pagato</th><th>Azione</th></tr></thead>
        <tbody>
          <tr *ngFor="let debt of customer.debtItems">
            <td>{{ debt.label || debt.sourceType }}</td>
            <td>{{ debt.amountTotal }}</td>
            <td>{{ debt.amountPaid }}</td>
            <td><app-payment-form (saved)="addPayment(debt.id, $event)" /></td>
          </tr>
        </tbody>
      </table>
      <ng-template #noDebts><p>Nessun debito collegato.</p></ng-template>
    </section>

    <section class="card" *ngIf="customer">
      <h2>Jobs collegati</h2>
      <table class="tbl" *ngIf="customer.jobs?.length; else noJobs">
        <thead><tr><th>Titolo</th><th>Stato</th><th>Scadenza</th><th>Azione</th></tr></thead>
        <tbody>
          <tr *ngFor="let job of customer.jobs">
            <td>{{ job.title }}</td>
            <td>{{ job.status }}</td>
            <td>{{ job.dueDate | date: 'dd/MM/yyyy' }}</td>
            <td><a class="btn-link" [routerLink]="['/gestionale/lavori', job.id]">Apri scheda</a></td>
          </tr>
        </tbody>
      </table>
      <ng-template #noJobs><p>Nessuna attivita.</p></ng-template>
    </section>
  `,
})
export class CustomerDetailComponent implements OnInit {
  customerId = '';
  customer: any;

  readonly noteForm = this.fb.group({
    text: ['', Validators.required],
  });

  readonly contactForm = this.fb.group({
    name: [''],
    email: [''],
    phone: [''],
    role: [''],
    isPrimary: [false],
  });

  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: ApiService,
    private readonly fb: FormBuilder,
  ) {}

  async ngOnInit() {
    this.customerId = String(this.route.snapshot.paramMap.get('id'));
    await this.reload();
  }

  async reload() {
    this.customer = await firstValueFrom(this.api.get(`/api/customers/${this.customerId}`));
  }

  async updateCustomer(payload: any) {
    await firstValueFrom(this.api.patch(`/api/customers/${this.customerId}`, payload));
    await this.reload();
  }

  async addNote() {
    if (this.noteForm.invalid) return;
    await firstValueFrom(this.api.post(`/api/customers/${this.customerId}/notes`, this.noteForm.getRawValue()));
    this.noteForm.reset();
    await this.reload();
  }

  async addContact() {
    await firstValueFrom(this.api.post(`/api/customers/${this.customerId}/contacts`, this.contactForm.getRawValue()));
    this.contactForm.reset({ isPrimary: false });
    await this.reload();
  }

  async deleteContact(contactId: string) {
    await firstValueFrom(this.api.delete(`/api/customers/${this.customerId}/contacts/${contactId}`));
    await this.reload();
  }

  async addPayment(debtId: string, payload: { amount: number; note: string }) {
    await firstValueFrom(this.api.post(`/api/debts/${debtId}/payments`, payload));
    await this.reload();
  }

  async deleteCustomer() {
    await firstValueFrom(this.api.delete(`/api/customers/${this.customerId}`));
    window.location.href = '/gestionale/clienti';
  }
}
