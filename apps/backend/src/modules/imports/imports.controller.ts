import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ImportsService } from './imports.service';

@Controller('api/imports')
@UseGuards(JwtAuthGuard, AdminGuard)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('run')
  run(@Body() body: unknown) {
    return this.importsService.run(body);
  }
}
