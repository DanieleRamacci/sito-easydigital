import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { AreaService } from './area.service';

@Controller('api/area')
@UseGuards(JwtAuthGuard)
export class AreaController {
  constructor(private readonly areaService: AreaService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.areaService.dashboard(user);
  }

  @Post('tickets')
  createTicket(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.areaService.createTicket(user, body);
  }
}
