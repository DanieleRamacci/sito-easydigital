import { z } from 'zod';
import {
  billingIntervals,
  customerStatuses,
  debtStatuses,
  inviteStatuses,
  serviceBillingTypes,
  subscriptionStatuses,
  ticketStatuses,
} from './enums';

const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => Number(v))
  .refine((v) => Number.isFinite(v), { message: 'Invalid amount' })
  .transform((v) => v.toFixed(2));

export const idParamSchema = z.object({ id: z.string().uuid() });

export const createCustomerSchema = z.object({
  company: z.string().trim().min(1).optional(),
  website: z.string().trim().optional().nullable(),
  vat: z.string().trim().optional().nullable(),
  billingAddress: z.string().trim().optional().nullable(),
  pec: z.string().trim().optional().nullable(),
  sdi: z.string().trim().optional().nullable(),
  firstName: z.string().trim().optional().nullable(),
  lastName: z.string().trim().optional().nullable(),
  email: z.string().trim().email().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  status: z.enum(customerStatuses).optional(),
  wpUserId: z.string().trim().optional().nullable(),
  wpUsername: z.string().trim().optional().nullable(),
  crmCompanyId: z.string().trim().optional().nullable(),
  crmPrimaryContactId: z.string().trim().optional().nullable(),
  createInvite: z.boolean().optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const customerContactSchema = z.object({
  name: z.string().trim().optional().nullable(),
  email: z.string().trim().email().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  role: z.string().trim().optional().nullable(),
  isPrimary: z.boolean().optional(),
});

export const customerNoteSchema = z.object({
  text: z.string().trim().min(1),
});

export const createServiceSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional().nullable(),
  price: decimalString,
  billingType: z.enum(serviceBillingTypes),
  billingInterval: z.enum(billingIntervals).optional().nullable(),
  active: z.boolean().optional(),
});

export const updateServiceSchema = createServiceSchema.partial();

export const updateServicePriceSchema = z.object({
  price: decimalString,
  note: z.string().trim().optional().nullable(),
});

export const createJobSchema = z.object({
  customerId: z.string().uuid(),
  title: z.string().trim().min(1),
  description: z.string().trim().optional().nullable(),
  status: z.string().trim().optional().nullable(),
  amount: decimalString.optional().nullable(),
  startDate: z.string().datetime().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
  crmDealId: z.string().trim().optional().nullable(),
  crmCompanyId: z.string().trim().optional().nullable(),
  crmContactId: z.string().trim().optional().nullable(),
  pipelineName: z.string().trim().optional().nullable(),
  documentsText: z.string().trim().optional().nullable(),
  serviceIds: z.array(z.string().uuid()).default([]),
});

export const updateJobSchema = createJobSchema.partial();

export const jobNoteSchema = z.object({
  text: z.string().trim().min(1),
});

export const updateSubscriptionSchema = z.object({
  purchaseDate: z.string().datetime().optional().nullable(),
  renewalDate: z.string().datetime().optional().nullable(),
  billingType: z.enum(serviceBillingTypes).optional(),
  billingInterval: z.enum(billingIntervals).optional().nullable(),
  priceAtSale: decimalString.optional(),
  status: z.enum(subscriptionStatuses).optional(),
  lastReminderSent: z.string().datetime().optional().nullable(),
});

export const createInviteSchema = z.object({
  customerId: z.string().uuid(),
  expiresAt: z.string().datetime().optional().nullable(),
});

export const completeInviteSchema = z.object({
  token: z.string().trim().min(8),
  company: z.string().trim().optional().nullable(),
  vat: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  billingAddress: z.string().trim().optional().nullable(),
  pec: z.string().trim().optional().nullable(),
  sdi: z.string().trim().optional().nullable(),
  wpUserId: z.string().trim().optional().nullable(),
  wpUsername: z.string().trim().optional().nullable(),
});

export const createTicketSchema = z.object({
  customerId: z.string().uuid().optional().nullable(),
  email: z.string().trim().email().optional().nullable(),
  subject: z.string().trim().min(1),
  message: z.string().trim().min(1),
});

export const updateTicketStatusSchema = z.object({
  status: z.enum(ticketStatuses),
});

export const createPaymentEntrySchema = z.object({
  amount: decimalString,
  note: z.string().trim().optional().nullable(),
  date: z.string().datetime().optional().nullable(),
  customerId: z.string().uuid().optional(),
});

export const debtQuerySchema = z.object({
  q: z.string().trim().optional(),
  customerId: z.string().uuid().optional(),
  status: z.enum(debtStatuses).optional(),
  paymentStatus: z.enum(['pending', 'paid']).optional(),
});

export const loginRedirectSchema = z.object({
  wpLoginUrl: z.string().url(),
});

export const importRunSchema = z.object({
  replaceExisting: z.boolean().optional().default(false),
  companiesCsv: z.string().optional(),
  contactsCsv: z.string().optional(),
  pipelinesCsv: z.string().optional(),
});

export const statusFiltersSchema = z.object({
  status: z.enum([...customerStatuses, ...inviteStatuses, ...ticketStatuses] as [string, ...string[]]).optional(),
});

export type CreateCustomerDto = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerDto = z.infer<typeof updateCustomerSchema>;
export type CreateServiceDto = z.infer<typeof createServiceSchema>;
export type UpdateServiceDto = z.infer<typeof updateServiceSchema>;
export type CreateJobDto = z.infer<typeof createJobSchema>;
export type UpdateJobDto = z.infer<typeof updateJobSchema>;
export type UpdateSubscriptionDto = z.infer<typeof updateSubscriptionSchema>;
export type CreateInviteDto = z.infer<typeof createInviteSchema>;
export type CompleteInviteDto = z.infer<typeof completeInviteSchema>;
export type CreateTicketDto = z.infer<typeof createTicketSchema>;
export type CreatePaymentEntryDto = z.infer<typeof createPaymentEntrySchema>;
