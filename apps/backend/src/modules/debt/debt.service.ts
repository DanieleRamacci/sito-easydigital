import { Injectable, NotFoundException } from '@nestjs/common';
import { createPaymentEntrySchema, debtQuerySchema } from '@eda/shared';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { decimalToNumber, parseZod } from '../../common/utils/parsers';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingRulesService } from '../billing/billing-rules.service';

@Injectable()
export class DebtService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingRulesService: BillingRulesService,
  ) {}

  async list(rawQuery: unknown) {
    const query = parseZod(debtQuerySchema, rawQuery);

    const debts = await this.prisma.debtItem.findMany({
      where: {
        customerId: query.customerId,
        status: query.status,
      },
      include: {
        customer: true,
        payments: { orderBy: { date: 'desc' } },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });

    const jobIds = debts.filter((d) => d.sourceType === 'job').map((d) => d.sourceId);
    const subIds = debts.filter((d) => d.sourceType === 'subscription').map((d) => d.sourceId);
    const [jobs, subscriptions] = await Promise.all([
      jobIds.length
        ? this.prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, title: true } })
        : Promise.resolve([]),
      subIds.length
        ? this.prisma.subscription.findMany({
            where: { id: { in: subIds } },
            include: { service: { select: { id: true, name: true } } },
          })
        : Promise.resolve([]),
    ]);

    const jobsMap = new Map(jobs.map((job) => [job.id, job]));
    const subsMap = new Map(subscriptions.map((sub) => [sub.id, sub]));

    return debts
      .map((debt) => {
        const sourceJob = debt.sourceType === 'job' ? jobsMap.get(debt.sourceId) : null;
        const sourceSub = debt.sourceType === 'subscription' ? subsMap.get(debt.sourceId) : null;
        const amountTotal = decimalToNumber(debt.amountTotal);
        const amountPaid = decimalToNumber(debt.amountPaid);
        const outstanding = Math.max(0, amountTotal - amountPaid);
        const paymentStatus = outstanding <= 0.009 ? 'paid' : 'pending';

        return {
          ...debt,
          job: sourceJob,
          subscription: sourceSub,
          outstanding,
          paymentStatus,
        };
      })
      .filter((debt) => {
        if (query.paymentStatus && debt.paymentStatus !== query.paymentStatus) return false;
        if (!query.q) return true;
        const blob = `${debt.customer.company ?? ''} ${debt.job?.title ?? ''} ${debt.subscription?.service?.name ?? ''}`.toLowerCase();
        return blob.includes(query.q.toLowerCase());
      });
  }

  async detail(id: string) {
    const debt = await this.prisma.debtItem.findUnique({
      where: { id },
      include: {
        customer: true,
        payments: { orderBy: { date: 'desc' } },
      },
    });

    if (!debt) throw new NotFoundException('Debt item not found');
    const [job, subscription] = await Promise.all([
      debt.sourceType === 'job'
        ? this.prisma.job.findUnique({ where: { id: debt.sourceId }, select: { id: true, title: true } })
        : Promise.resolve(null),
      debt.sourceType === 'subscription'
        ? this.prisma.subscription.findUnique({
            where: { id: debt.sourceId },
            include: { service: { select: { id: true, name: true } } },
          })
        : Promise.resolve(null),
    ]);

    return { ...debt, job, subscription };
  }

  async addPayment(id: string, payload: unknown, user: AuthUser) {
    const data = parseZod(createPaymentEntrySchema, payload);

    return this.prisma.$transaction(async (tx) => {
      const debt = await this.billingRulesService.applyPayment(tx, id, {
        amount: Number(data.amount),
        customerId: data.customerId,
        note: data.note ?? null,
        date: data.date ? new Date(data.date) : null,
      });

      return {
        debt,
        paid: decimalToNumber(debt.amountPaid) >= decimalToNumber(debt.amountTotal),
        by: user.email,
      };
    });
  }

  async listPayments(filters: { debtItemId?: string; customerId?: string }) {
    return this.prisma.paymentEntry.findMany({
      where: {
        debtItemId: filters.debtItemId,
        customerId: filters.customerId,
      },
      orderBy: { date: 'desc' },
      include: {
        debtItem: true,
        customer: true,
      },
    });
  }
}
