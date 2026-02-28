import { Injectable } from '@nestjs/common';
import { createTicketSchema, updateTicketStatusSchema } from '@eda/shared';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { parseZod } from '../../common/utils/parsers';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, status?: string) {
    const isAdmin = user.roles.includes('administrator');

    if (isAdmin) {
      return this.prisma.ticket.findMany({
        where: status ? { status: status as never } : undefined,
        orderBy: { createdAt: 'desc' },
        include: { customer: true },
      });
    }

    const where = await this.customerScopeWhere(user, status);

    return this.prisma.ticket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { customer: true },
    });
  }

  async create(user: AuthUser, payload: unknown) {
    const data = parseZod(createTicketSchema, payload);
    const isAdmin = user.roles.includes('administrator');

    let customerId = data.customerId ?? null;
    if (!isAdmin) {
      customerId = await this.resolveCustomerId(user);
    }

    return this.prisma.ticket.create({
      data: {
        customerId,
        wpUserId: user.wpUserId || null,
        email: data.email ?? user.email,
        subject: data.subject,
        message: data.message,
        status: 'open',
      },
    });
  }

  async updateStatus(id: string, payload: unknown) {
    const data = parseZod(updateTicketStatusSchema, payload);
    return this.prisma.ticket.update({
      where: { id },
      data: { status: data.status },
    });
  }

  private async resolveCustomerId(user: AuthUser): Promise<string | null> {
    const customer = await this.prisma.customer.findFirst({
      where: {
        OR: [
          user.wpUserId ? { wpUserId: user.wpUserId } : undefined,
          user.email ? { email: { equals: user.email, mode: 'insensitive' } } : undefined,
        ].filter(Boolean) as Prisma.CustomerWhereInput[],
      },
      select: { id: true },
    });

    return customer?.id ?? null;
  }

  private async customerScopeWhere(user: AuthUser, status?: string): Promise<Prisma.TicketWhereInput> {
    const customerId = await this.resolveCustomerId(user);
    return {
      status: status as never,
      OR: [
        customerId ? { customerId } : undefined,
        user.wpUserId ? { wpUserId: user.wpUserId } : undefined,
        user.email ? { email: { equals: user.email, mode: 'insensitive' } } : undefined,
      ].filter(Boolean) as Prisma.TicketWhereInput[],
    };
  }
}
