import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createJobSchema, jobNoteSchema, updateJobSchema } from '@eda/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { parseZod, toDate, toDecimal } from '../../common/utils/parsers';
import { BillingRulesService } from '../billing/billing-rules.service';

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingRulesService: BillingRulesService,
  ) {}

  async findAll(filters: { q?: string; status?: string; customerId?: string }) {
    const where: Prisma.JobWhereInput = {};

    if (filters.status) where.status = filters.status;
    if (filters.customerId) where.customerId = filters.customerId;

    if (filters.q) {
      where.OR = [
        { title: { contains: filters.q, mode: 'insensitive' } },
        { description: { contains: filters.q, mode: 'insensitive' } },
        { customer: { company: { contains: filters.q, mode: 'insensitive' } } },
        { customer: { email: { contains: filters.q, mode: 'insensitive' } } },
      ];
    }

    const jobs = await this.prisma.job.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: true,
        services: { include: { service: true } },
      },
    });

    return this.attachJobDebtItems(jobs);
  }

  async findOne(id: string) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: {
        customer: true,
        services: { include: { service: true } },
        subscriptions: { include: { service: true } },
        notes: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!job) throw new NotFoundException('Job not found');

    const jobDebt = await this.prisma.debtItem.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: 'job',
          sourceId: job.id,
        },
      },
      include: { payments: { orderBy: { date: 'desc' } } },
    });

    const subIds = job.subscriptions.map((sub) => sub.id);
    const subDebts = subIds.length
      ? await this.prisma.debtItem.findMany({
          where: {
            sourceType: 'subscription',
            sourceId: { in: subIds },
          },
          include: { payments: { orderBy: { date: 'desc' } } },
        })
      : [];

    const subDebtMap = new Map(subDebts.map((debt) => [debt.sourceId, debt]));

    return {
      ...job,
      debtItem: jobDebt,
      subscriptions: job.subscriptions.map((sub) => ({
        ...sub,
        debtItem: subDebtMap.get(sub.id) ?? null,
      })),
    };
  }

  async create(payload: unknown) {
    const data = parseZod(createJobSchema, payload);

    const created = await this.prisma.$transaction(async (tx) => {
      const job = await tx.job.create({
        data: {
          customerId: data.customerId,
          title: data.title,
          description: data.description ?? null,
          status: data.status ?? 'qualificazione_preventivo',
          amount: toDecimal(data.amount),
          startDate: toDate(data.startDate),
          dueDate: toDate(data.dueDate),
          crmDealId: data.crmDealId ?? null,
          crmCompanyId: data.crmCompanyId ?? null,
          crmContactId: data.crmContactId ?? null,
          pipelineName: data.pipelineName ?? null,
          documentsText: data.documentsText ?? null,
        },
      });

      if (data.serviceIds.length > 0) {
        await tx.jobService.createMany({
          data: data.serviceIds.map((serviceId) => ({ jobId: job.id, serviceId })),
          skipDuplicates: true,
        });
      }

      await this.billingRulesService.upsertDebtItemFromJob(tx, job.id);
      await this.billingRulesService.syncJobServiceSubscriptions(tx, job.id, data.serviceIds);

      return { id: job.id };
    });

    return this.findOne(created.id);
  }

  async update(id: string, payload: unknown) {
    const data = parseZod(updateJobSchema, payload);
    await this.ensureExists(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id },
        data: {
          customerId: data.customerId,
          title: data.title,
          description: data.description,
          status: data.status,
          amount: data.amount ? toDecimal(data.amount) : undefined,
          startDate: data.startDate !== undefined ? toDate(data.startDate) : undefined,
          dueDate: data.dueDate !== undefined ? toDate(data.dueDate) : undefined,
          crmDealId: data.crmDealId,
          crmCompanyId: data.crmCompanyId,
          crmContactId: data.crmContactId,
          pipelineName: data.pipelineName,
          documentsText: data.documentsText,
        },
      });

      const nextServiceIds = data.serviceIds ? Array.from(new Set(data.serviceIds)) : undefined;

      if (nextServiceIds) {
        await tx.jobService.deleteMany({ where: { jobId: id } });
        if (nextServiceIds.length > 0) {
          await tx.jobService.createMany({
            data: nextServiceIds.map((serviceId) => ({ jobId: id, serviceId })),
            skipDuplicates: true,
          });
        }
      }

      await this.billingRulesService.upsertDebtItemFromJob(tx, id);
      const syncServiceIds = nextServiceIds ?? (await tx.jobService.findMany({ where: { jobId: id } })).map((j) => j.serviceId);
      await this.billingRulesService.syncJobServiceSubscriptions(tx, id, syncServiceIds);
    });

    return this.findOne(id);
  }

  async remove(id: string) {
    await this.ensureExists(id);

    await this.prisma.$transaction(async (tx) => {
      const subIds = (await tx.subscription.findMany({ where: { jobId: id }, select: { id: true } })).map((s) => s.id);
      for (const subId of subIds) {
        const debt = await tx.debtItem.findUnique({
          where: {
            sourceType_sourceId: {
              sourceType: 'subscription',
              sourceId: subId,
            },
          },
        });
        if (debt) {
          await tx.paymentEntry.deleteMany({ where: { debtItemId: debt.id } });
          await tx.debtItem.delete({ where: { id: debt.id } });
        }
      }

      const jobDebt = await tx.debtItem.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType: 'job',
            sourceId: id,
          },
        },
      });

      if (jobDebt) {
        await tx.paymentEntry.deleteMany({ where: { debtItemId: jobDebt.id } });
        await tx.debtItem.delete({ where: { id: jobDebt.id } });
      }

      await tx.job.delete({ where: { id } });
    });

    return { ok: true };
  }

  async addNote(id: string, payload: unknown) {
    await this.ensureExists(id);
    const data = parseZod(jobNoteSchema, payload);

    return this.prisma.jobNote.create({
      data: {
        jobId: id,
        text: data.text,
      },
    });
  }

  async updateNote(id: string, noteId: string, payload: unknown) {
    await this.ensureExists(id);
    const data = parseZod(jobNoteSchema, payload);
    return this.prisma.jobNote.update({
      where: { id: noteId },
      data: { text: data.text },
    });
  }

  async updateStatus(id: string, status: string) {
    await this.ensureExists(id);

    return this.prisma.$transaction(async (tx) => {
      const job = await tx.job.update({
        where: { id },
        data: { status },
      });

      await this.billingRulesService.upsertDebtItemFromJob(tx, job.id);
      return job;
    });
  }

  private async ensureExists(id: string) {
    const job = await this.prisma.job.findUnique({ where: { id }, select: { id: true } });
    if (!job) throw new NotFoundException('Job not found');
  }

  private async attachJobDebtItems(jobs: any[]) {
    if (!jobs.length) return jobs;

    const jobIds = jobs.map((job) => job.id);
    const debts = await this.prisma.debtItem.findMany({
      where: {
        sourceType: 'job',
        sourceId: { in: jobIds },
      },
      include: { payments: true },
    });

    const debtMap = new Map(debts.map((debt) => [debt.sourceId, debt]));
    return jobs.map((job) => ({
      ...job,
      debtItem: debtMap.get(job.id) ?? null,
    }));
  }
}
