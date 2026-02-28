import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { JobsService } from './jobs.service';

@Controller('api/jobs')
@UseGuards(JwtAuthGuard, AdminGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get()
  findAll(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.jobsService.findAll({ q, status, customerId });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.jobsService.findOne(id);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.jobsService.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.jobsService.update(id, body);
  }

  @Post(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.jobsService.updateStatus(id, status);
  }

  @Post(':id/notes')
  addNote(@Param('id') id: string, @Body() body: unknown) {
    return this.jobsService.addNote(id, body);
  }

  @Patch(':id/notes/:noteId')
  updateNote(@Param('id') id: string, @Param('noteId') noteId: string, @Body() body: unknown) {
    return this.jobsService.updateNote(id, noteId, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.jobsService.remove(id);
  }
}
