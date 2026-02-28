import { Module } from '@nestjs/common';
import { DebtController } from './debt.controller';
import { DebtService } from './debt.service';
import { PaymentsController } from './payments.controller';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BillingModule],
  controllers: [DebtController, PaymentsController],
  providers: [DebtService],
  exports: [DebtService],
})
export class DebtModule {}
