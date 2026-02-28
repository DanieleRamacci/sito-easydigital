import { Component, EventEmitter, Output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
  selector: 'app-payment-form',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <form class="inline-actions" [formGroup]="form" (ngSubmit)="submit()">
      <input formControlName="amount" type="number" step="0.01" placeholder="Acconto" />
      <input formControlName="note" placeholder="Nota pagamento" />
      <button type="submit">Registra</button>
    </form>
  `,
})
export class PaymentFormComponent {
  @Output() saved = new EventEmitter<{ amount: number; note: string }>();

  readonly form = this.fb.group({
    amount: ['0', Validators.required],
    note: [''],
  });

  constructor(private readonly fb: FormBuilder) {}

  submit() {
    if (this.form.invalid) return;
    const raw = this.form.getRawValue();
    this.saved.emit({ amount: Number(raw.amount || 0), note: raw.note || '' });
  }
}
