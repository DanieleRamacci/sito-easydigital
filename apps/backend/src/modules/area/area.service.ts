import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { createTicketSchema } from '@eda/shared';
import { parseZod } from '../../common/utils/parsers';

@Injectable()
export class AreaService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(user: AuthUser) {
    const customer = await this.resolveCustomer(user);

    if (!customer) {
      return {
        customer: null,
        subscriptions: [],
        debts: [],
        tickets: [],
      };
    }

    const [subscriptions, debts, tickets] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { customerId: customer.id },
        include: { service: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.debtItem.findMany({
        where: { customerId: customer.id },
        include: { payments: { orderBy: { date: 'desc' } } },
        orderBy: { dueDate: 'asc' },
      }),
      this.prisma.ticket.findMany({
        where: {
          OR: [{ customerId: customer.id }, { wpUserId: user.wpUserId }, { email: user.email }],
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      customer,
      subscriptions,
      debts,
      tickets,
    };
  }

  async createTicket(user: AuthUser, payload: unknown) {
    const data = parseZod(createTicketSchema, payload);
    const customer = await this.resolveCustomer(user);

    return this.prisma.ticket.create({
      data: {
        customerId: customer?.id ?? null,
        wpUserId: user.wpUserId || null,
        email: user.email,
        subject: data.subject,
        message: data.message,
        status: 'open',
      },
    });
  }

  private resolveCustomer(user: AuthUser) {
    return this.prisma.customer.findFirst({
      where: {
        OR: [
          user.wpUserId ? { wpUserId: user.wpUserId } : undefined,
          user.email ? { email: { equals: user.email, mode: 'insensitive' } } : undefined,
        ].filter(Boolean) as any,
      },
    });
  }
}
