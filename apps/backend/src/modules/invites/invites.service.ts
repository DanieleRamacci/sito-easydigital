import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { completeInviteSchema, createInviteSchema } from '@eda/shared';
import { InviteStatus } from '@prisma/client';
import crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { parseZod, toDate } from '../../common/utils/parsers';

@Injectable()
export class InvitesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(customerId?: string) {
    return this.prisma.invite.findMany({
      where: customerId ? { customerId } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: true,
      },
    });
  }

  async create(payload: unknown) {
    const data = parseZod(createInviteSchema, payload);

    return this.prisma.invite.create({
      data: {
        customerId: data.customerId,
        token: crypto.randomBytes(24).toString('hex'),
        status: InviteStatus.pending,
        expiresAt: data.expiresAt ? toDate(data.expiresAt) : new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
  }

  async byToken(token: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { token },
      include: { customer: true },
    });

    if (!invite) throw new NotFoundException('Invite not found');

    if (invite.status !== InviteStatus.pending) {
      throw new BadRequestException('Invite already used');
    }

    if (invite.expiresAt && invite.expiresAt < new Date()) {
      await this.prisma.invite.update({
        where: { id: invite.id },
        data: { status: InviteStatus.expired },
      });
      throw new BadRequestException('Invite expired');
    }

    return invite;
  }

  async complete(payload: unknown) {
    const data = parseZod(completeInviteSchema, payload);
    const invite = await this.byToken(data.token);

    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.update({
        where: { id: invite.customerId },
        data: {
          company: data.company ?? invite.customer.company,
          vat: data.vat ?? invite.customer.vat,
          phone: data.phone ?? invite.customer.phone,
          billingAddress: data.billingAddress ?? invite.customer.billingAddress,
          pec: data.pec ?? invite.customer.pec,
          sdi: data.sdi ?? invite.customer.sdi,
          wpUserId: data.wpUserId ?? invite.customer.wpUserId,
          wpUsername: data.wpUsername ?? invite.customer.wpUsername,
          status: 'active',
        },
      });

      const completed = await tx.invite.update({
        where: { id: invite.id },
        data: {
          status: InviteStatus.completed,
          completedAt: new Date(),
        },
      });

      return { invite: completed, customer };
    });
  }
}
