import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { SubscriptionsService } from './subscriptions.service';

@Controller('api/subscriptions')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  findAll(@Query('q') q?: string, @Query('status') status?: string, @Query('customerId') customerId?: string) {
    return this.subscriptionsService.findAll({ q, status, customerId });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.subscriptionsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.subscriptionsService.update(id, body);
  }

  @Post(':id/price')
  updatePrice(@Param('id') id: string, @Body('price') price: number) {
    return this.subscriptionsService.updatePrice(id, Number(price));
  }
}
