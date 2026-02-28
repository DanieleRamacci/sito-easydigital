import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { CustomerFormComponent } from '../../../shared/customer-form.component';

@Component({
  selector: 'app-customer-create',
  standalone: true,
  imports: [RouterLink, CustomerFormComponent],
  template: `
    <h1>Nuovo cliente</h1>
    <section class="card">
      <h2>Anagrafica cliente e invito</h2>
      <app-customer-form (saved)="save($event)" />
    </section>
  `,
})
export class CustomerCreateComponent {
  constructor(
    private readonly api: ApiService,
    private readonly router: Router,
  ) {}

  async save(payload: any) {
    const created = await firstValueFrom(this.api.post<any>('/api/customers', { ...payload, createInvite: true }));
    await this.router.navigate(['/gestionale/clienti', created.id]);
  }
}
