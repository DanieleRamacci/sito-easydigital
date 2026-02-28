import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillingInterval,
  DebtItemType,
  DebtSourceType,
  DebtStatus,
  Prisma,
  ServiceBillingType,
  SubscriptionStatus,
} from '@prisma/client';
import { addMonths, decimalToNumber, toDate } from '../../common/utils/parsers';

type Tx = Prisma.TransactionClient;

@Injectable()
export class BillingRulesService {
  private computeRenewalDate(purchaseDate: Date, interval: BillingInterval | null): Date {
    const months = interval === 'monthly' ? 1 : interval === 'semiannual' ? 6 : 12;
    return addMonths(purchaseDate, months);
  }

  async syncJobServiceSubscriptions(tx: Tx, jobId: string, rawServiceIds: string[]): Promise<void> {
    const job = await tx.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');

    const serviceIds = Array.from(new Set(rawServiceIds.filter(Boolean)));
    const existingSubs = await tx.subscription.findMany({ where: { jobId } });
    const selectedServices = serviceIds.length
      ? await tx.service.findMany({ where: { id: { in: serviceIds } } })
      : [];

    const purchaseDate = job.startDate ?? job.createdAt;

    for (const service of selectedServices) {
      const existing = existingSubs.find((sub) => sub.serviceId === service.id);
      const billingType = service.billingType as ServiceBillingType;
      const billingInterval = service.billingInterval ?? null;

      if (!existing) {
        const created = await tx.subscription.create({
          data: {
            customerId: job.customerId,
            jobId: job.id,
            serviceId: service.id,
            purchaseDate,
            renewalDate:
              billingType === 'subscription'
                ? this.computeRenewalDate(purchaseDate, billingInterval)
                : null,
            billingType,
            billingInterval,
            priceAtSale: service.price,
            status: SubscriptionStatus.active,
          },
        });

        await this.upsertDebtItemFromSubscription(tx, created.id);
        continue;
      }

      await tx.subscription.update({
        where: { id: existing.id },
        data: {
          customerId: job.customerId,
          jobId: job.id,
          billingType,
          billingInterval,
          status:
            existing.status === SubscriptionStatus.cancelled
              ? SubscriptionStatus.active
              : existing.status,
        },
      });

      await this.upsertDebtItemFromSubscription(tx, existing.id);
    }

    for (const sub of existingSubs) {
      if (serviceIds.includes(sub.serviceId)) continue;

      const debt = await tx.debtItem.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType: DebtSourceType.subscription,
            sourceId: sub.id,
          },
        },
        include: { payments: true },
      });

      const hasPayments = (debt?.payments.length ?? 0) > 0;

      if (hasPayments) {
        await tx.subscription.update({
          where: { id: sub.id },
          data: { status: SubscriptionStatus.cancelled },
        });
        await this.upsertDebtItemFromSubscription(tx, sub.id);
        continue;
      }

      if (debt) {
        await tx.paymentEntry.deleteMany({ where: { debtItemId: debt.id } });
        await tx.debtItem.delete({ where: { id: debt.id } });
      }

      await tx.subscription.delete({ where: { id: sub.id } });
    }
  }

  async upsertDebtItemFromJob(tx: Tx, jobId: string) {
    const job = await tx.job.findUnique({
      where: { id: jobId },
      include: { services: true },
    });

    if (!job) throw new NotFoundException('Job not found');

    const existing = await tx.debtItem.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: DebtSourceType.job,
          sourceId: job.id,
        },
      },
    });

    if (job.services.length > 0) {
      if (existing) {
        await tx.paymentEntry.deleteMany({ where: { debtItemId: existing.id } });
        await tx.debtItem.delete({ where: { id: existing.id } });
      }
      return null;
    }

    const amountTotal = job.amount ?? 0;
    const totalNumber = decimalToNumber(amountTotal);
    const dueDate = job.dueDate ?? null;
    const status: DebtStatus = job.status === 'chiusa_persa' ? DebtStatus.cancelled : DebtStatus.open;

    if (!existing) {
      return tx.debtItem.create({
        data: {
          customerId: job.customerId,
          sourceType: DebtSourceType.job,
          sourceId: job.id,
          itemType: DebtItemType.one_time,
          label: job.title,
          dueDate,
          amountTotal,
          amountPaid: 0,
          status,
        },
      });
    }

    const paid = Math.min(decimalToNumber(existing.amountPaid), totalNumber);

    return tx.debtItem.update({
      where: { id: existing.id },
      data: {
        customerId: job.customerId,
        itemType: DebtItemType.one_time,
        label: job.title,
        dueDate,
        amountTotal,
        amountPaid: paid,
        status,
      },
    });
  }

  async upsertDebtItemFromSubscription(tx: Tx, subscriptionId: string) {
    const subscription = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      include: { service: true },
    });

    if (!subscription) throw new NotFoundException('Subscription not found');

    const existing = await tx.debtItem.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: DebtSourceType.subscription,
          sourceId: subscription.id,
        },
      },
    });

    const amountTotal = subscription.priceAtSale;
    const totalNumber = decimalToNumber(amountTotal);
    const dueDate = subscription.renewalDate ?? subscription.purchaseDate ?? null;
    const itemType: DebtItemType =
      subscription.billingType === ServiceBillingType.subscription
        ? DebtItemType.subscription
        : DebtItemType.one_time;
    const status: DebtStatus =
      subscription.status === SubscriptionStatus.cancelled ? DebtStatus.cancelled : DebtStatus.open;

    if (!existing) {
      return tx.debtItem.create({
        data: {
          customerId: subscription.customerId,
          sourceType: DebtSourceType.subscription,
          sourceId: subscription.id,
          itemType,
          label: subscription.service.name,
          dueDate,
          amountTotal,
          amountPaid: 0,
          status,
        },
      });
    }

    const paid = Math.min(decimalToNumber(existing.amountPaid), totalNumber);

    return tx.debtItem.update({
      where: { id: existing.id },
      data: {
        customerId: subscription.customerId,
        itemType,
        label: subscription.service.name,
        dueDate,
        amountTotal,
        amountPaid: paid,
        status,
      },
    });
  }

  async applyPayment(
    tx: Tx,
    debtItemId: string,
    payload: {
      amount: number;
      customerId?: string;
      note?: string | null;
      date?: Date | null;
    },
  ) {
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }

    const debtItem = await tx.debtItem.findUnique({ where: { id: debtItemId } });
    if (!debtItem) throw new NotFoundException('Debt item not found');

    const customerId = payload.customerId ?? debtItem.customerId;

    await tx.paymentEntry.create({
      data: {
        debtItemId,
        customerId,
        amount: payload.amount,
        note: payload.note ?? null,
        date: toDate(payload.date ?? null) ?? new Date(),
      },
    });

    const aggregate = await tx.paymentEntry.aggregate({
      where: { debtItemId },
      _sum: { amount: true },
    });

    const amountPaid = aggregate._sum.amount ?? 0;

    return tx.debtItem.update({
      where: { id: debtItemId },
      data: { amountPaid },
    });
  }
}
