import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
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

  const serviceOne = await prisma.service.create({
    data: {
      name: 'Realizzazione sito web',
      description: 'Sito professionale con SEO base',
      price: 1200,
      billingType: 'one_time',
      billingInterval: null,
      active: true,
    },
  });

  const serviceTwo = await prisma.service.create({
    data: {
      name: 'Gestione annuale',
      description: 'Assistenza, sicurezza e aggiornamenti',
      price: 490,
      billingType: 'subscription',
      billingInterval: 'annual',
      active: true,
    },
  });

  const customer = await prisma.customer.create({
    data: {
      company: 'Demo Srl',
      firstName: 'Mario',
      lastName: 'Rossi',
      email: 'mario.rossi@example.com',
      phone: '+39 333 0000000',
      status: 'active',
      wpUserId: '1001',
      wpUsername: 'mario.rossi',
    },
  });

  const job = await prisma.job.create({
    data: {
      customerId: customer.id,
      title: 'Nuovo sito corporate',
      description: 'Landing + pagine servizi',
      status: 'in_lavorazione',
      amount: 1200,
      startDate: new Date(),
      dueDate: new Date(Date.now() + 20 * 24 * 3600 * 1000),
    },
  });

  await prisma.jobService.create({
    data: {
      jobId: job.id,
      serviceId: serviceTwo.id,
    },
  });

  const subscription = await prisma.subscription.create({
    data: {
      customerId: customer.id,
      jobId: job.id,
      serviceId: serviceTwo.id,
      purchaseDate: new Date(),
      renewalDate: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      billingType: 'subscription',
      billingInterval: 'annual',
      priceAtSale: 490,
      status: 'active',
    },
  });

  await prisma.debtItem.create({
    data: {
      customerId: customer.id,
      sourceType: 'subscription',
      sourceId: subscription.id,
      itemType: 'subscription',
      label: 'Gestione annuale',
      dueDate: subscription.renewalDate,
      amountTotal: 490,
      amountPaid: 0,
      status: 'open',
    },
  });

  console.log('Seed completed:', {
    customerId: customer.id,
    serviceIds: [serviceOne.id, serviceTwo.id],
    jobId: job.id,
    subscriptionId: subscription.id,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
