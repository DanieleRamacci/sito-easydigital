import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { updateSubscriptionSchema } from '@eda/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { parseZod, toDate, toDecimal } from '../../common/utils/parsers';
import { BillingRulesService } from '../billing/billing-rules.service';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingRulesService: BillingRulesService,
  ) {}

  async findAll(query: { q?: string; status?: string; customerId?: string }) {
    const where: Prisma.SubscriptionWhereInput = {};

    if (query.status) where.status = query.status as never;
    if (query.customerId) where.customerId = query.customerId;

    if (query.q) {
      where.OR = [
        { service: { name: { contains: query.q, mode: 'insensitive' } } },
        { customer: { company: { contains: query.q, mode: 'insensitive' } } },
        { customer: { email: { contains: query.q, mode: 'insensitive' } } },
      ];
    }

    const rows = await this.prisma.subscription.findMany({
      where,
      orderBy: { renewalDate: 'asc' },
      include: {
        customer: true,
        service: true,
      },
    });

    return this.attachDebtItems(rows);
  }

  async findOne(id: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        customer: true,
        service: true,
        job: true,
      },
    });

    if (!subscription) throw new NotFoundException('Subscription not found');

    const debtItem = await this.prisma.debtItem.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: 'subscription',
          sourceId: subscription.id,
        },
      },
      include: { payments: { orderBy: { date: 'desc' } } },
    });

    return {
      ...subscription,
      debtItem,
    };
  }

  async update(id: string, payload: unknown) {
    const data = parseZod(updateSubscriptionSchema, payload);
    await this.ensureExists(id);

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id },
        data: {
          purchaseDate: data.purchaseDate !== undefined ? toDate(data.purchaseDate) : undefined,
          renewalDate: data.renewalDate !== undefined ? toDate(data.renewalDate) : undefined,
          billingType: data.billingType,
          billingInterval: data.billingInterval,
          priceAtSale: data.priceAtSale ? toDecimal(data.priceAtSale) : undefined,
          status: data.status,
          lastReminderSent: data.lastReminderSent !== undefined ? toDate(data.lastReminderSent) : undefined,
        },
      });

      await this.billingRulesService.upsertDebtItemFromSubscription(tx, id);
      return updated;
    });

    return this.findOne(id);
  }

  async updatePrice(id: string, price: number) {
    await this.ensureExists(id);

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id },
        data: {
          priceAtSale: price,
        },
      });

      await this.billingRulesService.upsertDebtItemFromSubscription(tx, id);
      return updated;
    });

    return this.findOne(id);
  }

  private async ensureExists(id: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!subscription) throw new NotFoundException('Subscription not found');
  }

  private async attachDebtItems(rows: any[]) {
    if (!rows.length) return rows;
    const ids = rows.map((row) => row.id);
    const debts = await this.prisma.debtItem.findMany({
      where: {
        sourceType: 'subscription',
        sourceId: { in: ids },
      },
      include: { payments: true },
    });
    const map = new Map(debts.map((debt) => [debt.sourceId, debt]));
    return rows.map((row) => ({
      ...row,
      debtItem: map.get(row.id) ?? null,
    }));
  }
}
