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
import { CustomersService } from './customers.service';

@Controller('api/customers')
@UseGuards(JwtAuthGuard, AdminGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  findAll(@Query('q') q?: string, @Query('status') status?: string) {
    return this.customersService.findAll({ q, status });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.customersService.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.customersService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.customersService.remove(id);
  }

  @Post(':id/notes')
  addNote(@Param('id') id: string, @Body() body: unknown) {
    return this.customersService.addNote(id, body);
  }

  @Post(':id/contacts')
  addContact(@Param('id') id: string, @Body() body: unknown) {
    return this.customersService.addContact(id, body);
  }

  @Patch(':id/contacts/:contactId')
  updateContact(
    @Param('id') id: string,
    @Param('contactId') contactId: string,
    @Body() body: unknown,
  ) {
    return this.customersService.updateContact(id, contactId, body);
  }

  @Delete(':id/contacts/:contactId')
  deleteContact(@Param('id') id: string, @Param('contactId') contactId: string) {
    return this.customersService.deleteContact(id, contactId);
  }

  @Post(':id/invites')
  createInvite(@Param('id') id: string) {
    return this.customersService.createInvite(id);
  }
}
