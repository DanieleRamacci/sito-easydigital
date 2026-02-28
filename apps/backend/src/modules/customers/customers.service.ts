import { Injectable, NotFoundException } from '@nestjs/common';
import { InviteStatus, Prisma } from '@prisma/client';
import {
  createCustomerSchema,
  customerContactSchema,
  customerNoteSchema,
  updateCustomerSchema,
} from '@eda/shared';
import crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { parseZod } from '../../common/utils/parsers';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: { q?: string; status?: string }) {
    const where: Prisma.CustomerWhereInput = {};

    if (query.status) {
      where.status = query.status as never;
    }

    if (query.q) {
      where.OR = [
        { company: { contains: query.q, mode: 'insensitive' } },
        { firstName: { contains: query.q, mode: 'insensitive' } },
        { lastName: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
        { phone: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    return this.prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        invites: { where: { status: InviteStatus.pending }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        contacts: { orderBy: { createdAt: 'desc' } },
        notes: { orderBy: { createdAt: 'desc' } },
        jobs: { orderBy: { createdAt: 'desc' }, include: { services: true } },
        subscriptions: { orderBy: { createdAt: 'desc' }, include: { service: true } },
        debtItems: { orderBy: { dueDate: 'asc' }, include: { payments: { orderBy: { date: 'desc' } } } },
        tickets: { orderBy: { createdAt: 'desc' } },
        invites: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async create(payload: unknown) {
    const data = parseZod(createCustomerSchema, payload);

    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          company: data.company ?? null,
          website: data.website ?? null,
          vat: data.vat ?? null,
          billingAddress: data.billingAddress ?? null,
          pec: data.pec ?? null,
          sdi: data.sdi ?? null,
          firstName: data.firstName ?? null,
          lastName: data.lastName ?? null,
          email: data.email ?? null,
          phone: data.phone ?? null,
          status: data.status,
          wpUserId: data.wpUserId ?? null,
          wpUsername: data.wpUsername ?? null,
          crmCompanyId: data.crmCompanyId ?? null,
          crmPrimaryContactId: data.crmPrimaryContactId ?? null,
        },
      });

      if (data.createInvite ?? true) {
        await tx.invite.create({
          data: {
            customerId: customer.id,
            token: crypto.randomBytes(24).toString('hex'),
            status: InviteStatus.pending,
            expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
          },
        });
      }

      return customer;
    });
  }

  async update(id: string, payload: unknown) {
    const data = parseZod(updateCustomerSchema, payload);

    await this.ensureExists(id);

    return this.prisma.customer.update({
      where: { id },
      data: {
        company: data.company,
        website: data.website,
        vat: data.vat,
        billingAddress: data.billingAddress,
        pec: data.pec,
        sdi: data.sdi,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        status: data.status,
        wpUserId: data.wpUserId,
        wpUsername: data.wpUsername,
        crmCompanyId: data.crmCompanyId,
        crmPrimaryContactId: data.crmPrimaryContactId,
      },
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.customer.delete({ where: { id } });
    return { ok: true };
  }

  async addContact(customerId: string, payload: unknown) {
    const data = parseZod(customerContactSchema, payload);
    await this.ensureExists(customerId);

    if (data.isPrimary) {
      await this.prisma.customerContact.updateMany({
        where: { customerId },
        data: { isPrimary: false },
      });
    }

    return this.prisma.customerContact.create({
      data: {
        customerId,
        name: data.name,
        email: data.email,
        phone: data.phone,
        role: data.role,
        isPrimary: data.isPrimary ?? false,
      },
    });
  }

  async updateContact(customerId: string, contactId: string, payload: unknown) {
    const data = parseZod(customerContactSchema, payload);
    await this.ensureExists(customerId);

    if (data.isPrimary) {
      await this.prisma.customerContact.updateMany({
        where: { customerId },
        data: { isPrimary: false },
      });
    }

    return this.prisma.customerContact.update({
      where: { id: contactId },
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        role: data.role,
        isPrimary: data.isPrimary,
      },
    });
  }

  async deleteContact(customerId: string, contactId: string) {
    await this.ensureExists(customerId);
    await this.prisma.customerContact.delete({ where: { id: contactId } });
    return { ok: true };
  }

  async addNote(customerId: string, payload: unknown) {
    const data = parseZod(customerNoteSchema, payload);
    await this.ensureExists(customerId);

    return this.prisma.customerNote.create({
      data: {
        customerId,
        text: data.text,
      },
    });
  }

  async createInvite(customerId: string, expiresAt?: Date | null) {
    await this.ensureExists(customerId);
    return this.prisma.invite.create({
      data: {
        customerId,
        token: crypto.randomBytes(24).toString('hex'),
        status: InviteStatus.pending,
        expiresAt: expiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
  }

  private async ensureExists(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id }, select: { id: true } });
    if (!customer) throw new NotFoundException('Customer not found');
  }
}
