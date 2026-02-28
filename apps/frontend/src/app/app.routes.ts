import { Routes } from '@angular/router';
import { adminGuard } from './core/guards/admin.guard';
import { authGuard } from './core/guards/auth.guard';
import { AreaLayoutComponent } from './layouts/area-layout.component';
import { LayoutShellComponent } from './layouts/layout-shell.component';
import { AdminDashboardComponent } from './features/admin/dashboard/admin-dashboard.component';
import { ServicesListComponent } from './features/admin/services/services-list.component';
import { ImportsPageComponent } from './features/admin/imports/imports-page.component';
import { CustomersListComponent } from './features/admin/customers/customers-list.component';
import { CustomerCreateComponent } from './features/admin/customers/customer-create.component';
import { CustomerDetailComponent } from './features/admin/customers/customer-detail.component';
import { JobsListComponent } from './features/admin/jobs/jobs-list.component';
import { JobCreateComponent } from './features/admin/jobs/job-create.component';
import { JobDetailComponent } from './features/admin/jobs/job-detail.component';
import { RenewalsListComponent } from './features/admin/renewals/renewals-list.component';
import { SubscriptionDetailComponent } from './features/admin/subscriptions/subscription-detail.component';
import { DebtListComponent } from './features/admin/debt/debt-list.component';
import { TicketsListComponent } from './features/admin/tickets/tickets-list.component';
import { AreaDashboardComponent } from './features/area/area-dashboard.component';
import { InviteAcceptPageComponent } from './features/area/invite-accept-page.component';
import { LogoutComponent } from './features/auth/logout.component';
import { RootRedirectComponent } from './features/root/root-redirect.component';

export const appRoutes: Routes = [
  { path: '', component: RootRedirectComponent },
  { path: 'logout', component: LogoutComponent },
  { path: 'areapersonale/invito', component: InviteAcceptPageComponent },
  {
    path: 'areapersonale',
    component: AreaLayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: '', component: AreaDashboardComponent },
    ],
  },
  {
    path: 'invito/:token',
    component: InviteAcceptPageComponent,
  },
  {
    path: 'gestionale',
    component: LayoutShellComponent,
    canActivate: [authGuard, adminGuard],
    children: [
      { path: '', component: AdminDashboardComponent },
      { path: 'servizi', component: ServicesListComponent },
      { path: 'importazioni', component: ImportsPageComponent },
      { path: 'clienti', component: CustomersListComponent },
      { path: 'clienti/new', component: CustomerCreateComponent },
      { path: 'clienti/:id', component: CustomerDetailComponent },
      { path: 'lavori', component: JobsListComponent },
      { path: 'lavori/new', component: JobCreateComponent },
      { path: 'lavori/:id', component: JobDetailComponent },
      { path: 'rinnovi', component: RenewalsListComponent },
      { path: 'abbonamenti/:id', component: SubscriptionDetailComponent },
      { path: 'debiti', component: DebtListComponent },
      { path: 'ticket', component: TicketsListComponent },
    ],
  },
  { path: '**', redirectTo: '' },
];
