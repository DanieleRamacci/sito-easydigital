import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'app-subscription-edit',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <form class="form-grid two-col" [formGroup]="form" (ngSubmit)="submit()">
      <input formControlName="priceAtSale" type="number" step="0.01" placeholder="Prezzo" />
      <input formControlName="renewalDate" type="datetime-local" />
      <select formControlName="status">
        <option value="active">Attivo</option>
        <option value="expired">Scaduto</option>
        <option value="cancelled">Annullato</option>
      </select>
      <button type="submit">Aggiorna abbonamento</button>
    </form>
  `,
})
export class SubscriptionEditComponent implements OnChanges {
  @Input() value: any;
  @Output() saved = new EventEmitter<any>();

  readonly form = this.fb.group({
    priceAtSale: ['0'],
    renewalDate: [''],
    status: ['active'],
  });

  constructor(private readonly fb: FormBuilder) {}

  ngOnChanges(): void {
    if (!this.value) return;
    const renewalDate = this.value.renewalDate ? this.toLocal(this.value.renewalDate) : '';
    this.form.patchValue({ ...this.value, renewalDate });
  }

  submit() {
    const raw = this.form.getRawValue();
    this.saved.emit({
      ...raw,
      priceAtSale: Number(raw.priceAtSale || 0),
      renewalDate: raw.renewalDate ? new Date(raw.renewalDate).toISOString() : null,
    });
  }

  private toLocal(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
}
