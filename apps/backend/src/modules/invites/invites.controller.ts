import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { InvitesService } from './invites.service';

@Controller('api/invites')
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  @Get()
  @UseGuards(JwtAuthGuard, AdminGuard)
  list(@Query('customerId') customerId?: string) {
    return this.invitesService.list(customerId);
  }

  @Post()
  @UseGuards(JwtAuthGuard, AdminGuard)
  create(@Body() body: unknown) {
    return this.invitesService.create(body);
  }

  @Get('token/:token')
  byToken(@Param('token') token: string) {
    return this.invitesService.byToken(token);
  }

  @Post('complete')
  complete(@Body() body: unknown) {
    return this.invitesService.complete(body);
  }
}
