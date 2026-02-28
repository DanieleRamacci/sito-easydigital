import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
  selector: 'app-customer-form',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <form class="form-grid two-col" [formGroup]="form" (ngSubmit)="submit()">
      <input formControlName="company" placeholder="Azienda" />
      <input formControlName="website" placeholder="Sito web" />
      <input formControlName="vat" placeholder="Partita IVA" />
      <input formControlName="billingAddress" placeholder="Indirizzo fatturazione" />
      <input formControlName="firstName" placeholder="Nome" />
      <input formControlName="lastName" placeholder="Cognome" />
      <input formControlName="email" placeholder="Email" />
      <input formControlName="phone" placeholder="Telefono" />
      <input formControlName="pec" placeholder="PEC" />
      <input formControlName="sdi" placeholder="SDI" />
      <button type="submit">Salva cliente</button>
    </form>
  `,
})
export class CustomerFormComponent implements OnChanges {
  @Input() value: any = null;
  @Output() saved = new EventEmitter<any>();

  readonly form = this.fb.group({
    company: [''],
    website: [''],
    vat: [''],
    billingAddress: [''],
    firstName: [''],
    lastName: [''],
    email: ['', Validators.email],
    phone: [''],
    pec: [''],
    sdi: [''],
  });

  constructor(private readonly fb: FormBuilder) {}

  ngOnChanges(): void {
    if (this.value) {
      this.form.patchValue(this.value);
    }
  }

  submit() {
    if (this.form.invalid) return;
    this.saved.emit(this.form.getRawValue());
  }
}
