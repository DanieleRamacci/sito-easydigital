import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgFor, NgIf } from '@angular/common';

@Component({
  selector: 'app-job-form',
  standalone: true,
  imports: [ReactiveFormsModule, NgFor, NgIf],
  template: `
    <form class="form-grid" [formGroup]="form" (ngSubmit)="submit()">
      <input formControlName="title" placeholder="Titolo attivita" />
      <textarea formControlName="description" rows="4" placeholder="Descrizione"></textarea>
      <div class="two-col form-grid">
        <input formControlName="status" placeholder="Stato" />
        <input formControlName="amount" type="number" step="0.01" placeholder="Importo" />
      </div>
      <div class="two-col form-grid">
        <input formControlName="startDate" type="datetime-local" />
        <input formControlName="dueDate" type="datetime-local" />
      </div>
      <label>Servizi collegati</label>
      <div class="selected-service-list">
        <label class="selected-service-item" *ngFor="let service of services">
          <span>{{ service.name }} - € {{ service.price }}</span>
          <input type="checkbox" [checked]="selectedSet.has(service.id)" (change)="toggleService(service.id, $event)" />
        </label>
      </div>
      <button type="submit">Salva attivita</button>
    </form>
  `,
})
export class JobFormComponent implements OnChanges {
  @Input() value: any = null;
  @Input() services: Array<{ id: string; name: string; price: number }> = [];
  @Output() saved = new EventEmitter<any>();

  selectedSet = new Set<string>();

  readonly form = this.fb.group({
    title: ['', Validators.required],
    description: [''],
    status: ['qualificazione_preventivo'],
    amount: ['0'],
    startDate: [''],
    dueDate: [''],
  });

  constructor(private readonly fb: FormBuilder) {}

  ngOnChanges(): void {
    if (this.value) {
      this.form.patchValue({
        ...this.value,
        startDate: this.asDateTimeLocal(this.value.startDate),
        dueDate: this.asDateTimeLocal(this.value.dueDate),
      });
      this.selectedSet = new Set<string>(this.value.serviceIds ?? this.value.services?.map((item: any) => item.serviceId) ?? []);
    }
  }

  toggleService(serviceId: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) this.selectedSet.add(serviceId);
    else this.selectedSet.delete(serviceId);
  }

  submit() {
    if (this.form.invalid) return;
    const raw = this.form.getRawValue();
    this.saved.emit({
      ...raw,
      amount: Number(raw.amount || 0),
      startDate: raw.startDate ? new Date(raw.startDate).toISOString() : null,
      dueDate: raw.dueDate ? new Date(raw.dueDate).toISOString() : null,
      serviceIds: Array.from(this.selectedSet),
    });
  }

  private asDateTimeLocal(value: string | null | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
}
