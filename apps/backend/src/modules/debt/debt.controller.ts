import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { DebtService } from './debt.service';

@Controller('api/debts')
@UseGuards(JwtAuthGuard, AdminGuard)
export class DebtController {
  constructor(private readonly debtService: DebtService) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('customerId') customerId?: string,
    @Query('status') status?: 'open' | 'cancelled',
    @Query('paymentStatus') paymentStatus?: 'pending' | 'paid',
  ) {
    return this.debtService.list({ q, customerId, status, paymentStatus });
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.debtService.detail(id);
  }

  @Post(':id/payments')
  addPayment(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthUser) {
    return this.debtService.addPayment(id, body, user);
  }
}
