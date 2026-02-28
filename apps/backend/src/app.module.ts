import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './modules/auth/health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ServicesModule } from './modules/services/services.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { InvitesModule } from './modules/invites/invites.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { DebtModule } from './modules/debt/debt.module';
import { AreaModule } from './modules/area/area.module';
import { ImportsModule } from './modules/imports/imports.module';
import { BillingModule } from './modules/billing/billing.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    BillingModule,
    CustomersModule,
    ServicesModule,
    JobsModule,
    SubscriptionsModule,
    InvitesModule,
    TicketsModule,
    DebtModule,
    AreaModule,
    ImportsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
