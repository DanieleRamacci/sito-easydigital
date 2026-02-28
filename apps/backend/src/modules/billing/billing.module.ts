import { Module } from '@nestjs/common';
import { BillingRulesService } from './billing-rules.service';

@Module({
  providers: [BillingRulesService],
  exports: [BillingRulesService],
})
export class BillingModule {}
