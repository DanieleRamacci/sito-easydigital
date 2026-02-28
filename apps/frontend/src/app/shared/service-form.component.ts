import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
  selector: 'app-service-form',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <form class="form-grid two-col" [formGroup]="form" (ngSubmit)="submit()">
      <input formControlName="name" placeholder="Nome servizio" />
      <textarea formControlName="description" rows="3" placeholder="Descrizione"></textarea>
      <input formControlName="price" type="number" step="0.01" placeholder="Prezzo" />
      <select formControlName="billingType">
        <option value="one_time">Una tantum</option>
        <option value="subscription">Abbonamento</option>
      </select>
      <select formControlName="billingInterval">
        <option value="">-</option>
        <option value="monthly">Mensile</option>
        <option value="semiannual">Semestrale</option>
        <option value="annual">Annuale</option>
      </select>
      <button type="submit">Salva servizio</button>
    </form>
  `,
})
export class ServiceFormComponent implements OnChanges {
  @Input() value: any = null;
  @Output() saved = new EventEmitter<any>();

  readonly form = this.fb.group({
    name: ['', Validators.required],
    description: [''],
    price: ['0', Validators.required],
    billingType: ['one_time', Validators.required],
    billingInterval: ['annual'],
  });

  constructor(private readonly fb: FormBuilder) {}

  ngOnChanges(): void {
    if (this.value) this.form.patchValue(this.value);
  }

  submit() {
    if (this.form.invalid) return;
    const raw = this.form.getRawValue();
    this.saved.emit({ ...raw, price: Number(raw.price || 0) });
  }
}
