import { DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

@Component({
  selector: 'app-jobs-list',
  standalone: true,
  imports: [NgIf, NgFor, DatePipe, RouterLink, ReactiveFormsModule],
  template: `
    <h1>Attivita</h1>

    <section class="card row-between">
      <p>Pipeline lavori e stato avanzamento.</p>
      <a class="btn-link" routerLink="/gestionale/lavori/new">+ Nuova attivita</a>
    </section>

    <section class="card">
      <form class="filter-grid" [formGroup]="filters" (ngSubmit)="reload()">
        <input formControlName="q" placeholder="Cerca attivita/cliente" />
        <input formControlName="status" placeholder="Stato" />
        <button type="submit">Filtra</button>
      </form>

      <table class="tbl" *ngIf="jobs.length; else noRows">
        <thead><tr><th>Titolo</th><th>Cliente</th><th>Stato</th><th>Scadenza</th><th>Azioni</th></tr></thead>
        <tbody>
          <tr *ngFor="let job of jobs">
            <td>{{ job.title }}</td>
            <td>{{ job.customer?.company || job.customer?.email }}</td>
            <td>{{ job.status }}</td>
            <td>{{ job.dueDate | date: 'dd/MM/yyyy' }}</td>
            <td>
              <a class="btn-link" [routerLink]="['/gestionale/lavori', job.id]">Scheda attivita</a>
            </td>
          </tr>
        </tbody>
      </table>
      <ng-template #noRows><p>Nessuna attivita.</p></ng-template>
    </section>
  `,
})
export class JobsListComponent implements OnInit {
  jobs: any[] = [];

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
    this.jobs = await firstValueFrom(
      this.api.get<any[]>('/api/jobs', {
        q: q || undefined,
        status: status || undefined,
      }),
    );
  }
}
