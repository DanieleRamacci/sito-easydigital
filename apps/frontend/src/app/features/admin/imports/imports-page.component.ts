import { NgIf } from '@angular/common';
import { Component } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

@Component({
  selector: 'app-imports-page',
  standalone: true,
  imports: [ReactiveFormsModule, NgIf],
  template: `
    <h1>Importazioni CRM</h1>
    <section class="card">
      <h2>Import CRM</h2>
      <p class="muted">Sezione di import allineata all'MVP: invio payload e run import.</p>
      <form class="form-grid" [formGroup]="form" (ngSubmit)="run()">
        <label style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" formControlName="replaceExisting" />
          <span>Sostituisci dati esistenti</span>
        </label>
        <textarea formControlName="companiesCsv" rows="5" placeholder="CSV aziende (opzionale)"></textarea>
        <textarea formControlName="contactsCsv" rows="5" placeholder="CSV contatti (opzionale)"></textarea>
        <textarea formControlName="pipelinesCsv" rows="5" placeholder="CSV pipeline (opzionale)"></textarea>
        <button type="submit">Run import</button>
      </form>
      <p class="notice" *ngIf="message">{{ message }}</p>
    </section>
  `,
})
export class ImportsPageComponent {
  message = '';

  readonly form = this.fb.group({
    replaceExisting: [false],
    companiesCsv: [''],
    contactsCsv: [''],
    pipelinesCsv: [''],
  });

  constructor(
    private readonly fb: FormBuilder,
    private readonly api: ApiService,
  ) {}

  async run() {
    const result = await firstValueFrom(this.api.post<any>('/api/imports/run', this.form.getRawValue()));
    this.message = result.message || 'Importazione completata';
  }
}
