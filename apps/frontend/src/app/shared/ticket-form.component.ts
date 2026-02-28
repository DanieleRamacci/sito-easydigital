import { Component, EventEmitter, Output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
  selector: 'app-ticket-form',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <form class="form-grid" [formGroup]="form" (ngSubmit)="submit()">
      <input formControlName="subject" placeholder="Oggetto" />
      <textarea formControlName="message" rows="4" placeholder="Descrivi la richiesta"></textarea>
      <button type="submit">Invia ticket</button>
    </form>
  `,
})
export class TicketFormComponent {
  @Output() saved = new EventEmitter<{ subject: string; message: string }>();

  readonly form = this.fb.group({
    subject: ['', Validators.required],
    message: ['', Validators.required],
  });

  constructor(private readonly fb: FormBuilder) {}

  submit() {
    if (this.form.invalid) return;
    this.saved.emit(this.form.getRawValue() as { subject: string; message: string });
    this.form.reset();
  }
}
