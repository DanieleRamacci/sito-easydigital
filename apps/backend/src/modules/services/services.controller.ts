import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ServicesService } from './services.service';

@Controller('api/services')
@UseGuards(JwtAuthGuard, AdminGuard)
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  findAll(@Query('active') active?: string) {
    return this.servicesService.findAll(active);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.servicesService.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.servicesService.update(id, body);
  }

  @Post(':id/price')
  updatePrice(@Param('id') id: string, @Body() body: unknown) {
    return this.servicesService.updatePrice(id, body);
  }
}
