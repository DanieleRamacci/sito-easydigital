import { BillingRulesService } from './billing-rules.service';

describe('BillingRulesService', () => {
  let service: BillingRulesService;

  beforeEach(() => {
    service = new BillingRulesService();
  });

  it('syncJobServiceSubscriptions creates missing subscriptions and removes stale ones without payments', async () => {
    const tx: any = {
      job: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'job-1',
          customerId: 'cus-1',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          startDate: null,
        }),
      },
      subscription: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sub-old',
            jobId: 'job-1',
            serviceId: 'srv-old',
            status: 'active',
          },
        ]),
        create: jest.fn().mockResolvedValue({ id: 'sub-new', serviceId: 'srv-1' }),
        update: jest.fn(),
        delete: jest.fn(),
      },
      service: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'srv-1',
            billingType: 'subscription',
            billingInterval: 'annual',
            price: 100,
          },
        ]),
      },
      debtItem: {
        findUnique: jest.fn().mockResolvedValue({ id: 'debt-old', payments: [] }),
        delete: jest.fn(),
      },
      paymentEntry: {
        deleteMany: jest.fn(),
      },
    };

    const upsertSpy = jest.spyOn(service, 'upsertDebtItemFromSubscription').mockResolvedValue({} as never);

    await service.syncJobServiceSubscriptions(tx, 'job-1', ['srv-1']);

    expect(tx.subscription.create).toHaveBeenCalledTimes(1);
    expect(tx.subscription.delete).toHaveBeenCalledWith({ where: { id: 'sub-old' } });
    expect(tx.debtItem.delete).toHaveBeenCalledWith({ where: { id: 'debt-old' } });
    expect(upsertSpy).toHaveBeenCalledWith(tx, 'sub-new');
  });

  it('upsertDebtItemFromJob creates debt for one-time jobs', async () => {
    const tx: any = {
      job: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'job-1',
          customerId: 'cus-1',
          title: 'Landing page',
          amount: 500,
          dueDate: new Date('2026-02-10T00:00:00.000Z'),
          status: 'in_lavorazione',
          services: [],
        }),
      },
      debtItem: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'debt-1' }),
      },
      paymentEntry: {
        deleteMany: jest.fn(),
      },
    };

    await service.upsertDebtItemFromJob(tx, 'job-1');

    expect(tx.debtItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceType: 'job',
          sourceId: 'job-1',
          itemType: 'one_time',
        }),
      }),
    );
  });

  it('upsertDebtItemFromSubscription updates amount and type', async () => {
    const tx: any = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sub-1',
          customerId: 'cus-1',
          billingType: 'subscription',
          status: 'active',
          priceAtSale: 290,
          renewalDate: new Date('2026-07-01T00:00:00.000Z'),
          purchaseDate: new Date('2026-01-01T00:00:00.000Z'),
          service: { name: 'Gestione annuale' },
        }),
      },
      debtItem: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'debt-sub-1',
          amountTotal: 250,
          amountPaid: 100,
        }),
        update: jest.fn().mockResolvedValue({ id: 'debt-sub-1' }),
      },
    };

    await service.upsertDebtItemFromSubscription(tx, 'sub-1');

    expect(tx.debtItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'debt-sub-1' },
        data: expect.objectContaining({
          itemType: 'subscription',
          label: 'Gestione annuale',
        }),
      }),
    );
  });

  it('applyPayment recalculates amountPaid from payment entries', async () => {
    const tx: any = {
      debtItem: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'debt-1',
          customerId: 'cus-1',
          amountTotal: 200,
          amountPaid: 50,
        }),
        update: jest.fn().mockResolvedValue({
          id: 'debt-1',
          amountTotal: 200,
          amountPaid: 100,
        }),
      },
      paymentEntry: {
        create: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { amount: 100 },
        }),
      },
    };

    const debt = await service.applyPayment(tx, 'debt-1', {
      amount: 50,
      note: 'acconto',
    });

    expect(tx.paymentEntry.create).toHaveBeenCalled();
    expect(tx.debtItem.update).toHaveBeenCalledWith({
      where: { id: 'debt-1' },
      data: { amountPaid: 100 },
    });
    expect(debt.amountPaid).toBe(100);
  });
});
