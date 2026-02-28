import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DebtService } from './debt.service';

@Controller('api/payments')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PaymentsController {
  constructor(private readonly debtService: DebtService) {}

  @Get()
  list(@Query('debtItemId') debtItemId?: string, @Query('customerId') customerId?: string) {
    return this.debtService.listPayments({ debtItemId, customerId });
  }
}
