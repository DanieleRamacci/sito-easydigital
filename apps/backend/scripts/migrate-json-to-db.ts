import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

interface LegacyStore {
  customers?: any[];
  services?: any[];
  jobs?: any[];
  subscriptions?: any[];
  invites?: any[];
  tickets?: any[];
  debtItems?: any[];
  paymentEntries?: any[];
}

const prisma = new PrismaClient();

function getDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDecimal(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

async function resetDb() {
  await prisma.paymentEntry.deleteMany();
  await prisma.debtItem.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.invite.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.jobNote.deleteMany();
  await prisma.jobService.deleteMany();
  await prisma.job.deleteMany();
  await prisma.servicePriceHistory.deleteMany();
  await prisma.service.deleteMany();
  await prisma.customerContact.deleteMany();
  await prisma.customerNote.deleteMany();
  await prisma.customer.deleteMany();
}

async function run() {
  const inputPath =
    process.argv[2] ||
    path.resolve(process.cwd(), '..', '..', 'manager-app', 'data', 'store.json');

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Legacy store file not found: ${inputPath}`);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  const store = JSON.parse(raw) as LegacyStore;

  await resetDb();

  const customers = ensureArray<any>(store.customers);
  const services = ensureArray<any>(store.services);
  const jobs = ensureArray<any>(store.jobs);
  const subscriptions = ensureArray<any>(store.subscriptions);
  const invites = ensureArray<any>(store.invites);
  const tickets = ensureArray<any>(store.tickets);
  const debtItems = ensureArray<any>(store.debtItems);
  const paymentEntries = ensureArray<any>(store.paymentEntries);

  for (const service of services) {
    const serviceId = String(service.id);
    await prisma.service.create({
      data: {
        id: serviceId,
        name: String(service.name ?? 'Servizio migrato'),
        description: service.description ? String(service.description) : null,
        price: getDecimal(service.price),
        billingType: service.billingType === 'subscription' ? 'subscription' : 'one_time',
        billingInterval:
          service.billingInterval === 'monthly' ||
          service.billingInterval === 'semiannual' ||
          service.billingInterval === 'annual'
            ? service.billingInterval
            : null,
        active: service.active !== false,
        createdAt: getDate(service.createdAt) ?? new Date(),
        updatedAt: getDate(service.updatedAt) ?? new Date(),
      },
    });

    for (const entry of ensureArray<any>(service.priceHistory)) {
      await prisma.servicePriceHistory.create({
        data: {
          serviceId,
          oldPrice: getDecimal(entry.oldPrice),
          newPrice: getDecimal(entry.newPrice),
          note: entry.note ? String(entry.note) : null,
          changedAt: getDate(entry.changedAt) ?? new Date(),
        },
      });
    }
  }

  for (const customer of customers) {
    const customerId = String(customer.id);
    await prisma.customer.create({
      data: {
        id: customerId,
        company: customer.company ? String(customer.company) : null,
        website: customer.website ? String(customer.website) : null,
        vat: customer.vat ? String(customer.vat) : null,
        billingAddress: customer.billingAddress ? String(customer.billingAddress) : null,
        pec: customer.pec ? String(customer.pec) : null,
        sdi: customer.sdi ? String(customer.sdi) : null,
        firstName: customer.firstName ? String(customer.firstName) : null,
        lastName: customer.lastName ? String(customer.lastName) : null,
        email: customer.email ? String(customer.email) : null,
        phone: customer.phone ? String(customer.phone) : null,
        status: ['lead', 'invited', 'active'].includes(String(customer.status))
          ? customer.status
          : 'lead',
        wpUserId: customer.wpUserId ? String(customer.wpUserId) : null,
        wpUsername: customer.wpUsername ? String(customer.wpUsername) : null,
        crmCompanyId: customer.crmCompanyId ? String(customer.crmCompanyId) : null,
        crmPrimaryContactId: customer.crmPrimaryContactId
          ? String(customer.crmPrimaryContactId)
          : null,
        createdAt: getDate(customer.createdAt) ?? new Date(),
        updatedAt: getDate(customer.updatedAt) ?? new Date(),
      },
    });

    for (const contact of ensureArray<any>(customer.crmContacts)) {
      await prisma.customerContact.create({
        data: {
          customerId,
          name: contact.name ? String(contact.name) : null,
          email: contact.email ? String(contact.email) : null,
          phone: contact.phone ? String(contact.phone) : null,
          role: contact.role ? String(contact.role) : null,
          isPrimary: contact.isPrimary === true,
          createdAt: getDate(contact.createdAt) ?? new Date(),
          updatedAt: getDate(contact.updatedAt) ?? new Date(),
        },
      });
    }

    for (const note of ensureArray<any>(customer.notes)) {
      await prisma.customerNote.create({
        data: {
          customerId,
          text: String(note.text ?? ''),
          createdAt: getDate(note.createdAt) ?? new Date(),
          updatedAt: getDate(note.updatedAt) ?? new Date(),
        },
      });
    }
  }

  for (const job of jobs) {
    const jobId = String(job.id);
    await prisma.job.create({
      data: {
        id: jobId,
        customerId: String(job.customerId),
        title: String(job.title ?? 'Lavoro migrato'),
        description: job.description ? String(job.description) : null,
        status: job.status ? String(job.status) : null,
        amount: job.amount !== undefined && job.amount !== null ? getDecimal(job.amount) : null,
        startDate: getDate(job.startDate),
        dueDate: getDate(job.dueDate),
        crmDealId: job.crmDealId ? String(job.crmDealId) : null,
        crmCompanyId: job.crmCompanyId ? String(job.crmCompanyId) : null,
        crmContactId: job.crmContactId ? String(job.crmContactId) : null,
        pipelineName: job.pipelineName ? String(job.pipelineName) : null,
        documentsText: job.documentsText ? String(job.documentsText) : null,
        createdAt: getDate(job.createdAt) ?? new Date(),
        updatedAt: getDate(job.updatedAt) ?? new Date(),
      },
    });

    for (const serviceId of ensureArray<any>(job.serviceIds)) {
      await prisma.jobService.create({
        data: {
          jobId,
          serviceId: String(serviceId),
          createdAt: new Date(),
        },
      });
    }

    for (const note of ensureArray<any>(job.notesList)) {
      await prisma.jobNote.create({
        data: {
          id: String(note.id ?? `${jobId}-${Math.random()}`),
          jobId,
          text: String(note.text ?? ''),
          createdAt: getDate(note.createdAt) ?? new Date(),
          updatedAt: getDate(note.updatedAt) ?? new Date(),
        },
      });
    }
  }

  for (const sub of subscriptions) {
    await prisma.subscription.create({
      data: {
        id: String(sub.id),
        customerId: String(sub.customerId),
        jobId: sub.jobId ? String(sub.jobId) : null,
        serviceId: String(sub.serviceId),
        purchaseDate: getDate(sub.purchaseDate),
        renewalDate: getDate(sub.renewalDate),
        billingType: sub.billingType === 'subscription' ? 'subscription' : 'one_time',
        billingInterval:
          sub.billingInterval === 'monthly' ||
          sub.billingInterval === 'semiannual' ||
          sub.billingInterval === 'annual'
            ? sub.billingInterval
            : null,
        priceAtSale: getDecimal(sub.priceAtSale),
        status:
          sub.status === 'active' || sub.status === 'expired' || sub.status === 'cancelled'
            ? sub.status
            : 'active',
        lastReminderSent: getDate(sub.lastReminderSent),
        crmDealId: sub.crmDealId ? String(sub.crmDealId) : null,
        createdAt: getDate(sub.createdAt) ?? new Date(),
        updatedAt: getDate(sub.updatedAt) ?? new Date(),
      },
    });
  }

  for (const invite of invites) {
    await prisma.invite.create({
      data: {
        id: String(invite.id),
        customerId: String(invite.customerId),
        token: String(invite.token),
        status:
          invite.status === 'pending' || invite.status === 'completed' || invite.status === 'expired'
            ? invite.status
            : 'pending',
        expiresAt: getDate(invite.expiresAt),
        completedAt: getDate(invite.completedAt),
        createdAt: getDate(invite.createdAt) ?? new Date(),
        updatedAt: getDate(invite.updatedAt) ?? new Date(),
      },
    });
  }

  for (const ticket of tickets) {
    await prisma.ticket.create({
      data: {
        id: String(ticket.id),
        customerId: ticket.customerId ? String(ticket.customerId) : null,
        wpUserId: ticket.wpUserId ? String(ticket.wpUserId) : null,
        email: ticket.email ? String(ticket.email) : null,
        subject: String(ticket.subject ?? 'Ticket migrato'),
        message: String(ticket.message ?? ''),
        status:
          ticket.status === 'open' || ticket.status === 'in_progress' || ticket.status === 'closed'
            ? ticket.status
            : 'open',
        createdAt: getDate(ticket.createdAt) ?? new Date(),
        updatedAt: getDate(ticket.updatedAt) ?? new Date(),
      },
    });
  }

  for (const debt of debtItems) {
    await prisma.debtItem.create({
      data: {
        id: String(debt.id),
        customerId: String(debt.customerId),
        sourceType: debt.sourceType === 'subscription' ? 'subscription' : 'job',
        sourceId: String(debt.sourceId),
        itemType: debt.itemType === 'subscription' ? 'subscription' : 'one_time',
        label: debt.label ? String(debt.label) : null,
        dueDate: getDate(debt.dueDate),
        amountTotal: getDecimal(debt.amountTotal),
        amountPaid: getDecimal(debt.amountPaid),
        status: debt.status === 'cancelled' ? 'cancelled' : 'open',
        createdAt: getDate(debt.createdAt) ?? new Date(),
        updatedAt: getDate(debt.updatedAt) ?? new Date(),
      },
    });
  }

  for (const payment of paymentEntries) {
    await prisma.paymentEntry.create({
      data: {
        id: String(payment.id),
        debtItemId: String(payment.debtItemId),
        customerId: String(payment.customerId),
        date: getDate(payment.date) ?? new Date(),
        amount: getDecimal(payment.amount),
        note: payment.note ? String(payment.note) : null,
        createdAt: getDate(payment.createdAt) ?? new Date(),
      },
    });
  }

  console.log('Migration complete:', {
    customers: customers.length,
    services: services.length,
    jobs: jobs.length,
    subscriptions: subscriptions.length,
    invites: invites.length,
    tickets: tickets.length,
    debtItems: debtItems.length,
    paymentEntries: paymentEntries.length,
  });
}

run()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
