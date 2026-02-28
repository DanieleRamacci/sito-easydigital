import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createServiceSchema, updateServicePriceSchema, updateServiceSchema } from '@eda/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { parseZod, toDecimal } from '../../common/utils/parsers';

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(active?: string) {
    const where: Prisma.ServiceWhereInput = {};
    if (active === 'true') where.active = true;
    if (active === 'false') where.active = false;

    return this.prisma.service.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        priceHistory: {
          orderBy: { changedAt: 'desc' },
          take: 10,
        },
      },
    });
  }

  async create(payload: unknown) {
    const data = parseZod(createServiceSchema, payload);
    return this.prisma.service.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        price: toDecimal(data.price) ?? 0,
        billingType: data.billingType,
        billingInterval: data.billingInterval ?? null,
        active: data.active ?? true,
      },
    });
  }

  async update(id: string, payload: unknown) {
    const data = parseZod(updateServiceSchema, payload);
    await this.ensureService(id);

    return this.prisma.service.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        price: data.price ? toDecimal(data.price) : undefined,
        billingType: data.billingType,
        billingInterval: data.billingInterval,
        active: data.active,
      },
    });
  }

  async updatePrice(id: string, payload: unknown) {
    const data = parseZod(updateServicePriceSchema, payload);
    const nextPrice = toDecimal(data.price) ?? 0;

    return this.prisma.$transaction(async (tx) => {
      const service = await tx.service.findUnique({ where: { id } });
      if (!service) throw new NotFoundException('Service not found');

      if (!service.price.equals(nextPrice)) {
        await tx.servicePriceHistory.create({
          data: {
            serviceId: id,
            oldPrice: service.price,
            newPrice: nextPrice,
            note: data.note ?? null,
          },
        });
      }

      return tx.service.update({
        where: { id },
        data: { price: nextPrice },
      });
    });
  }

  private async ensureService(id: string) {
    const service = await this.prisma.service.findUnique({ where: { id }, select: { id: true } });
    if (!service) throw new NotFoundException('Service not found');
  }
}
