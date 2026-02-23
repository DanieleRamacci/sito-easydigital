const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const PORT = Number(process.env.PORT || 3000);
const WP_BASE_URL = (process.env.WP_BASE_URL || '').replace(/\/+$/, '');
const EDA_SSO_SECRET = process.env.EDA_SSO_SECRET || 'change-me';
const SESSION_COOKIE = 'eda_mgr_session';
const DATA_DIR = process.env.DATA_DIR || '/data';
const STORE_FILE = path.join(DATA_DIR, 'store.json');

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || '';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

const JOB_STATUS_OPTIONS = [
  'qualificazione_preventivo',
  'scrittura_preventivo',
  'in_lavorazione',
  'in_attesa_pagamento',
  'gestione_annuale',
  'chiusa_acquisita',
  'chiusa_persa'
];

ensureStore();

app.get('/health', (_req, res) => res.json({ ok: true, app: 'eda-manager' }));

app.get(['/gestionale/auth/callback', '/areapersonale/auth/callback'], (req, res) => {
  const token = req.query.token;
  const next = sanitizeNext(req.query.next || '/areapersonale');
  if (!token || typeof token !== 'string') {
    return res.status(400).send('Token mancante');
  }
  try {
    jwt.verify(token, EDA_SSO_SECRET);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 1000
    });
    return res.redirect(next);
  } catch (_e) {
    return res.status(401).send('Token non valido');
  }
});

app.get('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.redirect('/areapersonale');
});

app.get('/areapersonale/invito', (req, res) => {
  const token = (req.query.token || '').trim();
  const store = readStore();
  const invite = store.invites.find((i) => i.token === token && i.status === 'pending');
  if (!invite) {
    return res.send(renderPublicPage('Invito non valido', '<p>Il link non e valido o e gia stato usato.</p>'));
  }

  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    invite.status = 'expired';
    writeStore(store);
    return res.send(renderPublicPage('Invito scaduto', '<p>Il link e scaduto. Chiedi un nuovo invito.</p>'));
  }

  const customer = store.customers.find((c) => c.id === invite.customerId);
  if (!customer) {
    return res.send(renderPublicPage('Errore', '<p>Cliente non trovato.</p>'));
  }

  res.send(renderPublicPage('Completa registrazione', renderInviteCompletionForm(customer, token, req.query.msg || '')));
});

app.post('/areapersonale/invito', async (req, res) => {
  const token = (req.body.token || '').trim();
  const password = (req.body.password || '').trim();

  const store = readStore();
  const invite = store.invites.find((i) => i.token === token && i.status === 'pending');
  if (!invite) {
    return res.send(renderPublicPage('Invito non valido', '<p>Il link non e valido o e gia stato usato.</p>'));
  }

  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
    invite.status = 'expired';
    writeStore(store);
    return res.send(renderPublicPage('Invito scaduto', '<p>Il link e scaduto. Chiedi un nuovo invito.</p>'));
  }

  const customer = store.customers.find((c) => c.id === invite.customerId);
  if (!customer) {
    return res.send(renderPublicPage('Errore', '<p>Cliente non trovato.</p>'));
  }

  const company = (req.body.company || '').trim();
  const vat = (req.body.vat || '').trim();
  const phone = (req.body.phone || '').trim();
  const billingAddress = (req.body.billingAddress || '').trim();
  const pec = (req.body.pec || '').trim();
  const sdi = (req.body.sdi || '').trim();

  if (!password) {
    return res.send(renderPublicPage('Completa registrazione', renderInviteCompletionForm(customer, token, 'Password obbligatoria')));
  }

  if (!WP_BASE_URL) {
    return res.status(500).send('WP_BASE_URL non configurato');
  }

  const displayName = `${customer.firstName} ${customer.lastName}`.trim();
  const username = makeUsername(customer.email, displayName);

  try {
    const resp = await fetch(`${WP_BASE_URL}/wp-json/eda-auth/v1/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email: customer.email, display_name: displayName, password })
    });

    const data = await resp.json();
    if (!resp.ok) {
      return res.send(renderPublicPage('Completa registrazione', renderInviteCompletionForm(customer, token, data.message || 'Errore registrazione')));
    }

    customer.company = company || customer.company;
    customer.vat = vat || customer.vat;
    customer.phone = phone || customer.phone;
    customer.billingAddress = billingAddress || customer.billingAddress;
    customer.pec = pec || customer.pec;
    customer.sdi = sdi || customer.sdi;
    customer.wpUserId = Number(data.user_id || 0) || null;
    customer.wpUsername = username;
    customer.status = 'active';
    customer.completedAt = new Date().toISOString();
    customer.updatedAt = new Date().toISOString();

    invite.status = 'completed';
    invite.completedAt = new Date().toISOString();

    writeStore(store);

    return res.redirect('/areapersonale/invito?token=' + encodeURIComponent(token) + '&msg=' + encodeURIComponent('Registrazione completata. Ora puoi accedere con Login WordPress.'));
  } catch (_err) {
    return res.send(renderPublicPage('Completa registrazione', renderInviteCompletionForm(customer, token, 'Errore di connessione a WordPress')));
  }
});

app.use(['/gestionale', '/areapersonale'], authMiddleware);

app.get('/areapersonale', (req, res) => {
  const store = readStore();
  const userId = Number(req.user.sub || 0);
  const userEmail = String(req.user.email || '').toLowerCase();

  const myCustomer = store.customers.find((c) => Number(c.wpUserId || 0) === userId || String(c.email || '').toLowerCase() === userEmail) || null;
  const myCustomerId = myCustomer ? Number(myCustomer.id) : 0;

  const mySubs = store.subscriptions.filter((s) => Number(s.customerId || 0) === myCustomerId || Number(s.wpUserId || 0) === userId);
  const myTickets = store.tickets.filter((t) => Number(t.customerId || 0) === myCustomerId || Number(t.wpUserId || 0) === userId);

  const enrichedSubs = mySubs.map((s) => {
    const srv = store.services.find((x) => x.id === s.serviceId);
    return {
      ...s,
      serviceName: srv ? srv.name : `Servizio #${s.serviceId}`,
      price: Number(s.priceAtSale || srv?.price || 0),
      billingType: s.billingType || srv?.billingType || 'one_time',
      billingInterval: s.billingInterval || srv?.billingInterval || '-'
    };
  });

  const body = `
    <h1>Area Personale</h1>
    <p>Ciao <strong>${esc(req.user.display_name || req.user.email)}</strong>. Qui trovi i tuoi servizi, rinnovi e ticket.</p>

    ${myCustomer ? renderCustomerSnapshot(myCustomer) : '<section class="card"><p>La tua anagrafica cliente non e ancora collegata. Contattaci per assistenza.</p></section>'}

    <section class="card">
      <h2>Servizi attivi / storico</h2>
      ${renderSubscriptionsTable(enrichedSubs)}
    </section>

    <section class="card">
      <h2>Apri ticket</h2>
      <form method="post" action="/areapersonale/ticket/new" class="form-grid">
        <input type="text" name="subject" placeholder="Oggetto" required />
        <textarea name="message" placeholder="Descrivi la richiesta" rows="4" required></textarea>
        <button type="submit">Invia ticket</button>
      </form>
    </section>

    <section class="card">
      <h2>I tuoi ticket</h2>
      ${renderTicketsTable(myTickets)}
    </section>
  `;

  res.send(renderAppLayout('Area Personale', body, req.user, false));
});

app.post('/areapersonale/ticket/new', (req, res) => {
  const subject = (req.body.subject || '').trim();
  const message = (req.body.message || '').trim();
  if (!subject || !message) {
    return res.redirect('/areapersonale');
  }

  const store = readStore();
  const userId = Number(req.user.sub || 0);
  const userEmail = String(req.user.email || '').toLowerCase();
  const customer = store.customers.find((c) => Number(c.wpUserId || 0) === userId || String(c.email || '').toLowerCase() === userEmail) || null;

  store.tickets.unshift({
    id: nextId(store.tickets),
    customerId: customer ? Number(customer.id) : null,
    wpUserId: userId || null,
    email: req.user.email,
    subject,
    message,
    status: 'open',
    createdAt: new Date().toISOString()
  });
  writeStore(store);
  res.redirect('/areapersonale');
});

app.use('/gestionale', requireAdmin);

app.get('/gestionale', (req, res) => {
  const store = readStore();
  const allRenewals = chronologicalRenewals(store);
  const allJobs = [...store.jobs].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const jobQ = (req.query.job_q || '').toString().trim();
  const jobStatus = (req.query.job_status || '').toString().trim();
  const renewQ = (req.query.renew_q || '').toString().trim();
  const renewPayment = (req.query.renew_payment || '').toString().trim();
  const jobs = filterJobs(allJobs, store.customers, store.services, jobQ, jobStatus);
  const renewals = filterRenewals(allRenewals, store.services, renewQ, renewPayment);

  const body = `
    <h1>Gestionale - Dashboard</h1>
    <div class="kpi-grid">
      ${kpi('Clienti', String(store.customers.length))}
      ${kpi('Servizi catalogo', String(store.services.length))}
      ${kpi('Commesse aperte', String(store.jobs.filter((j) => !j.status.startsWith('chiusa_')).length))}
      ${kpi('Rinnovi totali', String(allRenewals.length))}
      ${kpi('Ticket aperti', String(store.tickets.filter((t) => t.status !== 'closed').length))}
    </div>

    <section class="card">
      <div class="dash-tabs">
        <button type="button" class="dash-tab-btn is-active" data-tab="dash-jobs">Lavori / Commesse</button>
        <button type="button" class="dash-tab-btn" data-tab="dash-renewals">Rinnovi</button>
        <a class="btn-link" href="/gestionale/lavori">Apri tabella lavori</a>
        <a class="btn-link" href="/gestionale/rinnovi">Apri tabella rinnovi</a>
      </div>

      <div class="dash-tab-panel is-active" data-panel="dash-jobs">
        <div class="row-between">
          <h2>Pipeline lavori/commesse</h2>
          <a class="btn-link" href="/gestionale/lavori/new">+ Nuova commessa</a>
        </div>
        <form method="get" action="/gestionale" class="filter-grid">
          <input type="text" name="job_q" value="${esc(jobQ)}" placeholder="Cerca commessa/cliente/servizio" />
          <select name="job_status">
            <option value="">Tutti gli stati</option>
            ${JOB_STATUS_OPTIONS.map((s) => `<option value="${s}" ${jobStatus === s ? 'selected' : ''}>${esc(labelJobStatus(s))}</option>`).join('')}
          </select>
          <input type="hidden" name="renew_q" value="${esc(renewQ)}" />
          <input type="hidden" name="renew_payment" value="${esc(renewPayment)}" />
          <button type="submit">Filtra</button>
        </form>
        <div style="margin-top:12px">${renderJobsTable(jobs, store.customers, store.services, true)}</div>
      </div>

      <div class="dash-tab-panel" data-panel="dash-renewals">
        <h2>Rinnovi in ordine cronologico</h2>
        <form method="get" action="/gestionale" class="filter-grid">
          <input type="hidden" name="job_q" value="${esc(jobQ)}" />
          <input type="hidden" name="job_status" value="${esc(jobStatus)}" />
          <input type="text" name="renew_q" value="${esc(renewQ)}" placeholder="Cerca cliente/servizio" />
          <select name="renew_payment">
            <option value="">Stato pagamento: tutti</option>
            <option value="pending" ${renewPayment === 'pending' ? 'selected' : ''}>In attesa</option>
            <option value="paid" ${renewPayment === 'paid' ? 'selected' : ''}>Pagato</option>
          </select>
          <button type="submit">Filtra</button>
        </form>
        ${renderRenewalsTable(renewals, store.services, store.customers, true)}
      </div>
    </section>
  `;
  res.send(renderAppLayout('Gestionale', body, req.user, true));
});

app.get('/gestionale/servizi', (req, res) => {
  const store = readStore();
  const body = `
    <h1>Gestione Servizi</h1>
    <section class="card">
      <h2>Nuovo servizio</h2>
      ${renderServiceForm('/gestionale/servizi/new')}
    </section>
    <section class="card">
      <h2>Catalogo servizi</h2>
      ${renderServicesTable(store.services)}
    </section>
  `;
  res.send(renderAppLayout('Gestionale - Servizi', body, req.user, true));
});

app.post('/gestionale/servizi/new', (req, res) => {
  const store = readStore();
  const created = createServiceFromRequest(store, req.body);
  if (!created) return res.redirect('/gestionale/servizi');
  writeStore(store);
  res.redirect('/gestionale/servizi');
});

app.get('/gestionale/importazioni', (req, res) => {
  const msg = (req.query.msg || '').toString().trim();
  const body = `
    <h1>Importazioni CRM</h1>
    ${msg ? `<div class="notice">${esc(msg)}</div>` : ''}
    <section class="card">
      <h2>Importa Aziende, Contatti e Lavori da CSV</h2>
      <p class="muted">I file vengono collegati tramite ID sorgente (azienda/contatto/affare). Le fasi pipeline vengono mappate sugli stati del gestionale.</p>
      <form method="post" action="/gestionale/importazioni/run" enctype="multipart/form-data" class="form-grid">
        <label><strong>Aziende CSV</strong></label>
        <input type="file" name="companiesFile" accept=".csv,text/csv" required />

        <label><strong>Contatti CSV</strong></label>
        <input type="file" name="contactsFile" accept=".csv,text/csv" required />

        <label><strong>Pipeline / Affari CSV</strong></label>
        <input type="file" name="pipelinesFile" accept=".csv,text/csv" required />

        <label style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" name="replaceExisting" value="1" />
          <span>Sostituisci tutti i clienti e lavori attuali prima dell'import</span>
        </label>
        <button type="submit">Esegui importazione</button>
      </form>
    </section>
  `;
  res.send(renderAppLayout('Gestionale - Importazioni', body, req.user, true));
});

app.post('/gestionale/importazioni/run', upload.fields([
  { name: 'companiesFile', maxCount: 1 },
  { name: 'contactsFile', maxCount: 1 },
  { name: 'pipelinesFile', maxCount: 1 }
]), (req, res) => {
  const replaceExisting = req.body.replaceExisting === '1';

  try {
    const companiesFile = req.files?.companiesFile?.[0] || null;
    const contactsFile = req.files?.contactsFile?.[0] || null;
    const pipelinesFile = req.files?.pipelinesFile?.[0] || null;
    if (!companiesFile || !contactsFile || !pipelinesFile) {
      throw new Error('Carica tutti e 3 i file CSV: aziende, contatti, pipeline');
    }

    const store = readStore();
    const summary = importCrmCsvData(store, {
      companiesCsvText: companiesFile.buffer.toString('utf8'),
      contactsCsvText: contactsFile.buffer.toString('utf8'),
      pipelinesCsvText: pipelinesFile.buffer.toString('utf8'),
      replaceExisting
    });
    writeStore(store);
    const msg = `Import completato. Aziende create/aggiornate: ${summary.customersUpserted}. Contatti collegati: ${summary.contactsLinked}. Lavori creati/aggiornati: ${summary.jobsUpserted}.`;
    return res.redirect('/gestionale/importazioni?msg=' + encodeURIComponent(msg));
  } catch (err) {
    const msg = `Errore importazione: ${err.message || 'errore sconosciuto'}`;
    return res.redirect('/gestionale/importazioni?msg=' + encodeURIComponent(msg));
  }
});

app.get('/gestionale/clienti', (req, res) => {
  const store = readStore();
  const q = (req.query.q || '').toString().trim();
  const status = (req.query.status || '').toString().trim();
  const filteredCustomers = filterCustomers(store.customers, q, status);
  const body = `
    <h1>Clienti</h1>
    <section class="card row-between">
      <p>Gestisci anagrafiche, inviti, servizi e storico rinnovi.</p>
      <a class="btn-link" href="/gestionale/clienti/new">+ Aggiungi cliente</a>
    </section>

    <section class="card">
      <h2>Tabella clienti</h2>
      <form method="get" action="/gestionale/clienti" class="filter-grid">
        <input type="text" name="q" value="${esc(q)}" placeholder="Cerca azienda/referente/email/telefono" />
        <select name="status">
          <option value="">Tutti gli stati</option>
          ${['active', 'invited', 'lead'].map((s) => `<option value="${s}" ${status === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
        </select>
        <button type="submit">Filtra</button>
      </form>
      ${renderCustomersTable(store, filteredCustomers)}
    </section>
  `;
  res.send(renderAppLayout('Gestionale - Clienti', body, req.user, true));
});

app.get('/gestionale/clienti/new', (req, res) => {
  const returnTo = sanitizeManagerReturn(req.query.returnTo, '/gestionale/clienti');
  const body = `
    <h1>Nuovo cliente</h1>
    <section class="card">
      <h2>Anagrafica cliente e invito</h2>
      <form method="post" action="/gestionale/clienti/new" class="form-grid two-col">
        <input type="hidden" name="returnTo" value="${esc(returnTo)}" />
        <input type="text" name="company" placeholder="Azienda" required />
        <input type="url" name="website" placeholder="Sito web" />
        <input type="text" name="vat" placeholder="Partita IVA" />
        <input type="text" name="firstName" placeholder="Nome referente" required />
        <input type="text" name="lastName" placeholder="Cognome referente" required />
        <input type="email" name="email" placeholder="Email" required />
        <input type="text" name="phone" placeholder="Telefono" required />
        <input type="text" name="billingAddress" placeholder="Indirizzo di fatturazione" />
        <input type="text" name="pec" placeholder="PEC" />
        <input type="text" name="sdi" placeholder="Codice SDI" />
        <button type="submit">Crea cliente e genera link invito</button>
      </form>
    </section>
  `;
  res.send(renderAppLayout('Gestionale - Nuovo Cliente', body, req.user, true));
});

app.post('/gestionale/clienti/new', async (req, res) => {
  const returnTo = sanitizeManagerReturn(req.body.returnTo, '/gestionale/clienti');
  const company = (req.body.company || '').trim();
  const firstName = (req.body.firstName || '').trim();
  const lastName = (req.body.lastName || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const phone = (req.body.phone || '').trim();

  if (!company || !firstName || !lastName || !email || !phone) {
    return res.redirect('/gestionale/clienti/new?returnTo=' + encodeURIComponent(returnTo));
  }

  const store = readStore();
  const existing = store.customers.find((c) => String(c.email || '').toLowerCase() === email);
  if (existing) {
    if (returnTo === '/gestionale/lavori/new') {
      return res.redirect(`/gestionale/lavori/new?customerId=${existing.id}&msg=cliente_esistente`);
    }
    return res.redirect(`/gestionale/clienti/${existing.id}`);
  }

  const customerId = nextId(store.customers);
  const customer = {
    id: customerId,
    company,
    website: (req.body.website || '').trim(),
    vat: (req.body.vat || '').trim(),
    firstName,
    lastName,
    email,
    phone,
    billingAddress: (req.body.billingAddress || '').trim(),
    pec: (req.body.pec || '').trim(),
    sdi: (req.body.sdi || '').trim(),
    status: 'invited',
    wpUserId: null,
    wpUsername: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  store.customers.unshift(customer);

  const inviteToken = randomToken();
  const invite = {
    id: nextId(store.invites),
    customerId,
    token: inviteToken,
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: addDaysIso(14),
    completedAt: ''
  };
  store.invites.unshift(invite);

  const inviteUrl = `${WP_BASE_URL}/areapersonale/invito?token=${encodeURIComponent(inviteToken)}`;
  maybeSendInviteEmail(customer, invite, inviteUrl);

  writeStore(store);
  if (returnTo === '/gestionale/lavori/new') {
    return res.redirect(`/gestionale/lavori/new?customerId=${customerId}&msg=cliente_creato`);
  }
  return res.redirect(`/gestionale/clienti/${customerId}`);
});

app.get('/gestionale/clienti/:id', (req, res) => {
  const store = readStore();
  const id = Number(req.params.id || 0);
  const selectedYear = Number(req.query.year || 0) || new Date().getFullYear();
  const customer = store.customers.find((c) => Number(c.id) === id);
  if (!customer) {
    return res.status(404).send(renderPublicPage('Cliente non trovato', '<p>Cliente non trovato.</p>'));
  }

  const customerSubs = store.subscriptions.filter((s) => Number(s.customerId) === id);
  const customerTickets = store.tickets.filter((t) => Number(t.customerId || 0) === id);
  const customerJobs = store.jobs.filter((j) => Number(j.customerId || 0) === id);
  const upcoming = customerSubs
    .filter((s) => s.billingType === 'subscription' && s.renewalDate)
    .sort((a, b) => String(a.renewalDate).localeCompare(String(b.renewalDate)));
  const history = customerSubs
    .filter((s) => s.renewalDate)
    .sort((a, b) => String(b.renewalDate).localeCompare(String(a.renewalDate)));

  const serviceOptions = store.services
    .map((s) => `<option value="${s.id}">${esc(s.name)} (${labelBilling(s.billingType, s.billingInterval)})</option>`)
    .join('');

  const invite = store.invites.find((i) => i.customerId === id && i.status === 'pending');
  const inviteLink = invite ? `${WP_BASE_URL}/areapersonale/invito?token=${invite.token}` : '';
  const latestJob = [...customerJobs].sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))[0];
  const pipelineStage = latestJob ? normalizeJobStatus(latestJob.status) : 'qualificazione_preventivo';
  const totalValue = customerSubs.reduce((sum, s) => sum + Number(s.priceAtSale || 0), 0);
  const customerNotes = Array.isArray(customer.notes) ? [...customer.notes].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))) : [];
  const customerPayments = Array.isArray(customer.payments) ? customer.payments : [];
  const expectedAnnualTotal = computeExpectedAnnualTotal(customerSubs, selectedYear);
  const paymentsForYear = customerPayments.filter((p) => Number(p.year || new Date(p.date || '').getFullYear()) === selectedYear);
  const paidAnnualTotal = paymentsForYear.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const annualRemaining = Math.max(0, expectedAnnualTotal - paidAnnualTotal);
  const paymentsRows = paymentsForYear.length
    ? paymentsForYear
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .map((p) => `<tr><td>${esc(formatDateItShort(p.date || '-'))}</td><td>€ ${Number(p.amount || 0).toFixed(2)}</td><td>${esc(p.note || '-')}</td></tr>`)
      .join('')
    : '<tr><td colspan="3" class="muted">Nessun versamento registrato per questo anno.</td></tr>';
  const contacts = Array.isArray(customer.crmContacts) ? customer.crmContacts : [];
  const contactsList = contacts.length
    ? contacts.map((c) => `<li class="contact-item">
        <form method="post" action="/gestionale/clienti/${id}/contacts/update" class="inline-actions">
          <input type="hidden" name="contactId" value="${esc(c.id || '')}" />
          <input type="text" name="name" placeholder="Nome contatto" value="${esc(c.name || '')}" />
          <input type="email" name="email" placeholder="Email contatto" value="${esc(c.email || '')}" />
          <button type="submit">Salva</button>
        </form>
        <form method="post" action="/gestionale/clienti/${id}/contacts/delete" onsubmit="return confirm('Eliminare questo contatto?');">
          <input type="hidden" name="contactId" value="${esc(c.id || '')}" />
          <button type="submit" class="danger-btn ghost icon-btn" title="Elimina contatto" aria-label="Elimina contatto">🗑</button>
        </form>
      </li>`).join('')
    : '<li class="muted">Nessun contatto secondario.</li>';

  const body = `
    <section class="crm-header card">
      <div class="crm-title-wrap">
        <a class="crm-back" href="/gestionale/clienti">← Clienti</a>
        <h1>${esc(customer.company || `${customer.firstName} ${customer.lastName}`)} · Totale servizi € ${totalValue.toFixed(2)}</h1>
        <div class="muted">Referente: ${esc(`${customer.firstName} ${customer.lastName}`.trim())}</div>
      </div>
      <div class="crm-actions">
        <a class="btn-link" href="mailto:${esc(customer.email)}">Invia e-mail</a>
        ${inviteLink ? `<a class="btn-link" href="${esc(inviteLink)}" target="_blank" rel="noopener">Link invito</a>` : ''}
        <form method="post" action="/gestionale/clienti/${id}/delete" onsubmit="return confirm('Eliminare azienda e tutti i dati collegati (lavori, rinnovi, ticket, inviti)?');">
          <button type="submit" class="danger-btn">Elimina azienda</button>
        </form>
      </div>
    </section>

    <section class="card crm-pipeline">
      ${renderPipeline(pipelineStage)}
    </section>
    ${latestJob ? `
      <section class="card">
        <h2>Avanzamento rapido pipeline</h2>
        <form method="post" action="/gestionale/lavori/${latestJob.id}/status" class="row-between">
          <div>
            <strong>${esc(latestJob.title)}</strong>
            <div class="muted">Stato attuale: ${esc(labelJobStatus(latestJob.status))}</div>
          </div>
          <div class="inline-actions">
            <select name="status">
              ${JOB_STATUS_OPTIONS.map((s) => `<option value="${s}" ${latestJob.status === s ? 'selected' : ''}>${esc(labelJobStatus(s))}</option>`).join('')}
            </select>
            <button type="submit">Aggiorna fase</button>
          </div>
        </form>
      </section>
    ` : ''}

    <section class="crm-layout">
      <aside class="card crm-left">
        <h2>Contatto correlato</h2>
        <p><strong>${esc(`${customer.firstName} ${customer.lastName}`.trim())}</strong></p>
        <p>${esc(customer.email)}</p>
        <p>${esc(customer.phone || '-')}</p>
        <form method="post" action="/gestionale/clienti/${id}/contacts/delete" onsubmit="return confirm('Eliminare il contatto principale?');">
          <input type="hidden" name="contactId" value="__primary__" />
          <button type="submit" class="danger-btn ghost">Elimina contatto principale</button>
        </form>
        <h2>Contatti associati</h2>
        <ul class="contact-list">${contactsList}</ul>
        <h2>Societa correlata</h2>
        <p><strong>${esc(customer.company || '-')}</strong></p>
        <p>Sito web: ${customer.website ? `<a href="${esc(customer.website)}" target="_blank" rel="noopener">${esc(customer.website)}</a>` : '-'}</p>
        <p>P.IVA: ${esc(customer.vat || '-')}</p>
        <p>PEC: ${esc(customer.pec || '-')}</p>
        <p>SDI: ${esc(customer.sdi || '-')}</p>
        <p>Stato: <span class="status-badge">${esc(customer.status)}</span></p>

        <h2>Aggiorna anagrafica</h2>
        <form method="post" action="/gestionale/clienti/${id}/update" class="form-grid">
          <input type="text" name="company" placeholder="Azienda" value="${esc(customer.company || '')}" required />
          <input type="url" name="website" placeholder="Sito web" value="${esc(customer.website || '')}" />
          <input type="text" name="firstName" placeholder="Nome referente" value="${esc(customer.firstName || '')}" />
          <input type="text" name="lastName" placeholder="Cognome referente" value="${esc(customer.lastName || '')}" />
          <input type="email" name="email" placeholder="Email" value="${esc(customer.email || '')}" />
          <input type="text" name="phone" placeholder="Telefono" value="${esc(customer.phone || '')}" />
          <input type="text" name="vat" placeholder="Partita IVA" value="${esc(customer.vat || '')}" />
          <input type="text" name="pec" placeholder="PEC" value="${esc(customer.pec || '')}" />
          <input type="text" name="sdi" placeholder="SDI" value="${esc(customer.sdi || '')}" />
          <input type="text" name="billingAddress" placeholder="Indirizzo fatturazione" value="${esc(customer.billingAddress || '')}" />
          <button type="submit">Salva anagrafica</button>
        </form>
      </aside>

      <section class="card crm-right">
        <div class="crm-tabs">
          <button class="crm-tab-btn is-active" data-tab="sequenza">Sequenza temporale</button>
          <button class="crm-tab-btn" data-tab="note">Note (${customerNotes.length})</button>
          <button class="crm-tab-btn" data-tab="servizi">Servizi</button>
          <button class="crm-tab-btn" data-tab="rinnovi">Abbonamenti</button>
          <button class="crm-tab-btn" data-tab="pagamenti">Pagamenti</button>
          <button class="crm-tab-btn" data-tab="ticket">Ticket</button>
          <button class="crm-tab-btn" data-tab="commesse">Commesse</button>
        </div>

        <div class="crm-tab-panel is-active" data-panel="sequenza">
          ${renderJobsTimeline(customerJobs)}
        </div>

        <div class="crm-tab-panel" data-panel="note">
          <form method="post" action="/gestionale/clienti/${id}/note" class="form-grid">
            <textarea name="text" rows="3" placeholder="Di che cosa tratta la nota?" required></textarea>
            <button type="submit">Salva nota</button>
          </form>
          ${renderCustomerNotes(customerNotes)}
        </div>

        <div class="crm-tab-panel" data-panel="servizi">
          <section class="card">
            <h2>Aggiungi servizio</h2>
            <form method="post" action="/gestionale/clienti/${id}/assign" class="form-grid two-col">
              <select name="serviceId">
                <option value="">Aggiungi dalla lista o crea nuovo</option>
                ${serviceOptions}
              </select>
              <input type="date" name="purchaseDate" required />

              <input name="newServiceName" type="text" placeholder="Nuovo servizio: nome (opzionale)" />
              <input name="newServicePrice" type="number" step="0.01" min="0" placeholder="Nuovo servizio: prezzo" />
              <input name="customPrice" type="number" step="0.01" min="0" placeholder="Prezzo custom vendita (opzionale)" />

              <select name="newServiceBillingType">
                <option value="one_time">Nuovo servizio: una tantum</option>
                <option value="subscription">Nuovo servizio: abbonamento</option>
              </select>
              <select name="newServiceBillingInterval">
                <option value="monthly">Nuovo servizio: mensile</option>
                <option value="semiannual">Nuovo servizio: semestrale</option>
                <option value="annual">Nuovo servizio: annuale</option>
              </select>

              <select name="billingTypeOverride">
                <option value="auto">Tipo fatturazione: auto da servizio</option>
                <option value="one_time">Una tantum</option>
                <option value="subscription">Abbonamento</option>
              </select>
              <select name="billingIntervalOverride">
                <option value="auto">Periodo rinnovo: auto da servizio</option>
                <option value="monthly">Mensile</option>
                <option value="semiannual">Semestrale</option>
                <option value="annual">Annuale</option>
              </select>

              <select name="status">
                <option value="active">Attivo</option>
                <option value="expired">Scaduto</option>
                <option value="cancelled">Annullato</option>
              </select>
              <textarea name="notes" rows="2" placeholder="Note servizio"></textarea>

              <button type="submit">Associa servizio</button>
            </form>
          </section>
          ${renderSubscriptionsTableForAdmin(customerSubs, store.services, true)}
        </div>

        <div class="crm-tab-panel" data-panel="rinnovi">
          <h2>Prossimi abbonamenti in scadenza</h2>
          ${renderRenewalsTable(upcoming, store.services, store.customers, false)}
          <h2 style="margin-top:16px">Storico abbonamenti / pagamenti</h2>
          ${renderRenewalsTable(history, store.services, store.customers, false)}
        </div>

        <div class="crm-tab-panel" data-panel="pagamenti">
          <section class="card">
            <h2>Gestione versamenti annuali</h2>
            <form method="get" action="/gestionale/clienti/${id}" class="inline-actions" style="margin-bottom:10px">
              <input type="number" name="year" min="2020" max="2100" value="${selectedYear}" />
              <button type="submit">Cambia anno</button>
            </form>
            <div class="kpi-grid">
              ${kpi(`Totale dovuto ${selectedYear}`, `€ ${expectedAnnualTotal.toFixed(2)}`)}
              ${kpi(`Versato ${selectedYear}`, `€ ${paidAnnualTotal.toFixed(2)}`)}
              ${kpi(`Residuo ${selectedYear}`, `€ ${annualRemaining.toFixed(2)}`)}
            </div>
            <form method="post" action="/gestionale/clienti/${id}/payments/new" class="form-grid two-col" style="margin-top:12px">
              <input type="hidden" name="year" value="${selectedYear}" />
              <input type="date" name="date" required />
              <input type="number" name="amount" step="0.01" min="0.01" placeholder="Importo versato" required />
              <input type="text" name="note" placeholder="Nota versamento (opzionale)" />
              <button type="submit">Registra versamento</button>
            </form>
            <table class="tbl" style="margin-top:12px">
              <thead><tr><th>Data pagamento</th><th>Importo</th><th>Note</th></tr></thead>
              <tbody>${paymentsRows}</tbody>
            </table>
          </section>
        </div>

        <div class="crm-tab-panel" data-panel="ticket">
          ${renderAdminTickets(customerTickets, [customer])}
        </div>

        <div class="crm-tab-panel" data-panel="commesse">
          ${renderJobsTable(customerJobs, store.customers, store.services, true)}
        </div>
      </section>
    </section>

    <script>
      (function () {
        const btns = document.querySelectorAll('.crm-tab-btn');
        const panels = document.querySelectorAll('.crm-tab-panel');
        btns.forEach((btn) => {
          btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');
            btns.forEach((b) => b.classList.remove('is-active'));
            panels.forEach((p) => p.classList.remove('is-active'));
            btn.classList.add('is-active');
            const panel = document.querySelector('.crm-tab-panel[data-panel=\"' + tab + '\"]');
            if (panel) panel.classList.add('is-active');
          });
        });
      })();
    </script>
  `;

  res.send(renderAppLayout('Gestionale - Dettaglio Cliente', body, req.user, true));
});

app.post('/gestionale/clienti/:id/note', (req, res) => {
  const store = readStore();
  const customerId = Number(req.params.id || 0);
  const text = (req.body.text || '').trim();
  const customer = store.customers.find((c) => Number(c.id) === customerId);
  if (!customer || !text) return res.redirect(`/gestionale/clienti/${customerId}`);
  if (!Array.isArray(customer.notes)) customer.notes = [];
  customer.notes.unshift({
    id: Date.now(),
    text,
    createdAt: new Date().toISOString()
  });
  customer.updatedAt = new Date().toISOString();
  writeStore(store);
  res.redirect(`/gestionale/clienti/${customerId}`);
});

app.post('/gestionale/clienti/:id/update', (req, res) => {
  const store = readStore();
  const customerId = Number(req.params.id || 0);
  const customer = store.customers.find((c) => Number(c.id) === customerId);
  if (!customer) return res.redirect('/gestionale/clienti');

  customer.company = (req.body.company || '').trim() || customer.company;
  customer.website = (req.body.website || '').trim();
  customer.firstName = (req.body.firstName || '').trim();
  customer.lastName = (req.body.lastName || '').trim();
  customer.email = (req.body.email || '').trim().toLowerCase();
  customer.phone = (req.body.phone || '').trim();
  customer.vat = (req.body.vat || '').trim();
  customer.pec = (req.body.pec || '').trim();
  customer.sdi = (req.body.sdi || '').trim();
  customer.billingAddress = (req.body.billingAddress || '').trim();
  customer.updatedAt = new Date().toISOString();

  writeStore(store);
  return res.redirect(`/gestionale/clienti/${customerId}`);
});

app.post('/gestionale/clienti/:id/payments/new', (req, res) => {
  const store = readStore();
  const customerId = Number(req.params.id || 0);
  const customer = store.customers.find((c) => Number(c.id) === customerId);
  if (!customer) return res.redirect('/gestionale/clienti');

  const amount = Number(req.body.amount || 0);
  const date = (req.body.date || '').trim();
  const year = Number(req.body.year || 0) || new Date().getFullYear();
  const note = (req.body.note || '').trim();
  if (!date || !Number.isFinite(amount) || amount <= 0) {
    return res.redirect(`/gestionale/clienti/${customerId}?year=${year}`);
  }

  if (!Array.isArray(customer.payments)) customer.payments = [];
  customer.payments.unshift({
    id: Date.now(),
    date,
    amount,
    note,
    year,
    createdAt: new Date().toISOString()
  });
  customer.updatedAt = new Date().toISOString();
  writeStore(store);
  return res.redirect(`/gestionale/clienti/${customerId}?year=${year}`);
});

app.post('/gestionale/clienti/:id/contacts/delete', (req, res) => {
  const store = readStore();
  const customerId = Number(req.params.id || 0);
  const contactId = (req.body.contactId || '').toString().trim();
  const customer = store.customers.find((c) => Number(c.id) === customerId);
  if (!customer || !contactId) return res.redirect(`/gestionale/clienti/${customerId}`);

  if (contactId === '__primary__') {
    customer.firstName = '';
    customer.lastName = '';
    customer.email = '';
    customer.phone = '';
    customer.crmPrimaryContactId = '';
  } else {
    if (!Array.isArray(customer.crmContacts)) customer.crmContacts = [];
    customer.crmContacts = customer.crmContacts.filter((c) => String(c.id || '') !== contactId);
    if (String(customer.crmPrimaryContactId || '') === contactId) customer.crmPrimaryContactId = '';
  }

  customer.updatedAt = new Date().toISOString();
  writeStore(store);
  return res.redirect(`/gestionale/clienti/${customerId}`);
});

app.post('/gestionale/clienti/:id/contacts/update', (req, res) => {
  const store = readStore();
  const customerId = Number(req.params.id || 0);
  const contactId = (req.body.contactId || '').toString().trim();
  const name = (req.body.name || '').toString().trim();
  const email = (req.body.email || '').toString().trim().toLowerCase();
  const customer = store.customers.find((c) => Number(c.id) === customerId);
  if (!customer || !contactId) return res.redirect(`/gestionale/clienti/${customerId}`);
  if (!Array.isArray(customer.crmContacts)) customer.crmContacts = [];
  const contact = customer.crmContacts.find((c) => String(c.id || '') === contactId);
  if (contact) {
    contact.name = name || contact.name || '';
    contact.email = email || contact.email || '';
    customer.updatedAt = new Date().toISOString();
    writeStore(store);
  }
  return res.redirect(`/gestionale/clienti/${customerId}`);
});

app.post('/gestionale/clienti/:id/delete', (req, res) => {
  const store = readStore();
  const customerId = Number(req.params.id || 0);
  const exists = store.customers.some((c) => Number(c.id) === customerId);
  if (!exists) return res.redirect('/gestionale/clienti');

  store.customers = store.customers.filter((c) => Number(c.id) !== customerId);
  store.jobs = store.jobs.filter((j) => Number(j.customerId || 0) !== customerId);
  store.subscriptions = store.subscriptions.filter((s) => Number(s.customerId || 0) !== customerId);
  store.tickets = store.tickets.filter((t) => Number(t.customerId || 0) !== customerId);
  store.invites = store.invites.filter((i) => Number(i.customerId || 0) !== customerId);

  writeStore(store);
  return res.redirect('/gestionale/clienti');
});

app.post('/gestionale/clienti/:id/assign', (req, res) => {
  const store = readStore();
  const customerId = Number(req.params.id || 0);
  const customer = store.customers.find((c) => Number(c.id) === customerId);
  if (!customer) return res.redirect('/gestionale/clienti');

  const serviceId = resolveServiceForAssignment(store, req.body);
  if (!serviceId) return res.redirect(`/gestionale/clienti/${customerId}`);

  const service = store.services.find((s) => Number(s.id) === serviceId);
  const purchaseDate = (req.body.purchaseDate || '').trim();
  if (!service || !purchaseDate) return res.redirect(`/gestionale/clienti/${customerId}`);

  const billingType = deriveBillingType(req.body.billingTypeOverride, service.billingType);
  const billingInterval = deriveBillingInterval(req.body.billingIntervalOverride, service.billingInterval);
  const renewalDate = billingType === 'subscription' ? computeRenewalDate(purchaseDate, billingInterval) : '';
  const customPrice = Number(req.body.customPrice || 0);
  const priceAtSale = customPrice > 0 ? customPrice : Number(service.price || 0);

  store.subscriptions.unshift({
    id: nextId(store.subscriptions),
    customerId: customer.id,
    wpUserId: customer.wpUserId || null,
    customerName: `${customer.firstName} ${customer.lastName}`.trim(),
    company: customer.company,
    email: customer.email,
    serviceId,
    purchaseDate,
    renewalDate,
    billingType,
    billingInterval,
    priceAtSale,
    status: req.body.status || 'active',
    paymentStatus: 'pending',
    notes: (req.body.notes || '').trim(),
    lastReminderSent: ''
  });

  writeStore(store);
  res.redirect(`/gestionale/clienti/${customerId}`);
});

app.get('/gestionale/lavori', (req, res) => {
  const store = readStore();
  const q = (req.query.q || '').toString().trim();
  const status = (req.query.status || '').toString().trim();
  const rows = filterJobs(store.jobs, store.customers, store.services, q, status);
  const body = `
    <h1>Lavori / Commesse</h1>
    <section class="card row-between">
      <p>Pipeline commerciale e operativa delle richieste clienti.</p>
      <a class="btn-link" href="/gestionale/lavori/new">+ Nuova commessa</a>
    </section>

    <section class="card">
      <form method="get" action="/gestionale/lavori" class="filter-grid">
        <input type="text" name="q" value="${esc(q)}" placeholder="Cerca commessa/cliente/servizio" />
        <select name="status">
          <option value="">Tutti gli stati</option>
          ${JOB_STATUS_OPTIONS.map((s) => `<option value="${s}" ${status === s ? 'selected' : ''}>${esc(labelJobStatus(s))}</option>`).join('')}
        </select>
        <button type="submit">Filtra</button>
      </form>
      ${renderJobsTable(rows, store.customers, store.services, true)}
    </section>
  `;
  res.send(renderAppLayout('Gestionale - Lavori', body, req.user, true));
});

app.get('/gestionale/lavori/new', (req, res) => {
  const store = readStore();
  const selectedCustomerId = Number(req.query.customerId || 0);
  const noticeType = (req.query.msg || '').toString();
  const notice = noticeType === 'cliente_creato'
    ? '<div class="notice success">Nuovo cliente creato e selezionato nel form.</div>'
    : noticeType === 'cliente_esistente'
      ? '<div class="notice">Cliente gia esistente trovato e selezionato.</div>'
      : '';

  const customersForUi = store.customers.map((c) => ({
    id: Number(c.id),
    company: c.company || '',
    contactName: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
    email: c.email || '',
    phone: c.phone || ''
  }));
  const customerOptions = store.customers
    .map((c) => {
      const selected = Number(c.id) === selectedCustomerId ? 'selected' : '';
      return `<option value="${c.id}" ${selected}>${esc(c.company || `${c.firstName} ${c.lastName}`)} - ${esc(c.email)}</option>`;
    })
    .join('');
  const serviceOptions = store.services.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const customerJson = JSON.stringify(customersForUi)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  const body = `
    <h1>Crea Affare</h1>
    ${notice}
    <section class="card">
      <form method="post" action="/gestionale/lavori/new" class="form-grid">
        <h2>Informazioni Affare</h2>
        <div class="affare-grid">
          <label for="title">Nome Affare</label>
          <input id="title" type="text" name="title" placeholder="Nome affare" required />

          <label for="companySearch">Nome Societa</label>
          <div>
            <input id="companySearch" type="text" placeholder="Cerca azienda nel menu a tendina" />
            <select id="customerId" name="customerId" required>
              <option value="">Seleziona azienda</option>
              ${customerOptions}
              <option value="__new__">+ Aggiungi nuova azienda e contatto</option>
            </select>
            <details id="inlineCustomerCreate" class="inline-create">
              <summary>+ Aggiungi Azienda e Contatto</summary>
              <div class="two-col form-grid">
                <input type="text" name="newCustomerCompany" placeholder="Azienda" />
                <input type="text" name="newCustomerPhone" placeholder="Telefono contatto" />
                <input type="text" name="newCustomerFirstName" placeholder="Nome contatto" />
                <input type="text" name="newCustomerLastName" placeholder="Cognome contatto" />
                <input type="email" name="newCustomerEmail" placeholder="Email contatto" />
                <div class="row-between" style="align-items:center">
                  <span class="muted">Oppure crea da pagina dedicata:</span>
                  <a class="btn-link" href="/gestionale/clienti/new?returnTo=/gestionale/lavori/new">Aggiungi cliente</a>
                </div>
              </div>
            </details>
          </div>

          <label for="contactName">Nome Contatto</label>
          <div>
            <input id="contactName" type="text" name="contactName" placeholder="Nome e cognome contatto" />
            <input id="contactEmail" type="email" name="contactEmail" placeholder="Email contatto" />
          </div>

          <label for="secondaryContacts">Contatti secondario</label>
          <input id="secondaryContacts" type="text" name="secondaryContacts" placeholder="Cerca o inserisci contatti secondari" />

          <label for="pipelineName">Pipeline secondaria & Fase</label>
          <div class="two-col" style="display:grid;gap:10px">
            <select id="pipelineName" name="pipelineName">
              <option value="Pipeline di vendita standard">Pipeline di vendita standard</option>
              <option value="Pipeline annuale">Pipeline annuale</option>
              <option value="Pipeline tecnico-operativa">Pipeline tecnico-operativa</option>
            </select>
            <select name="status">
              ${JOB_STATUS_OPTIONS.map((s) => `<option value="${s}">${esc(labelJobStatus(s))}</option>`).join('')}
            </select>
          </div>

          <label for="amount">Valore</label>
          <input id="amount" type="number" name="amount" step="0.01" min="0" placeholder="0.00" />

          <label for="dueDate">Data di chiusura</label>
          <input id="dueDate" type="date" name="dueDate" />

          <label for="description">Descrizione</label>
          <textarea id="description" name="description" rows="3" placeholder="Alcune osservazioni su affare"></textarea>
        </div>

        <h2>Informazioni addizionali</h2>
        <div class="affare-grid">
          <label for="downPayment">Anticipo versato</label>
          <input id="downPayment" type="number" name="downPayment" step="0.01" min="0" placeholder="0.00" />

          <label for="remainingBalance">Saldo mancante</label>
          <input id="remainingBalance" type="number" name="remainingBalance" step="0.01" min="0" placeholder="0.00" />

          <label for="annualDueDate">Scadenza gestione annuale</label>
          <input id="annualDueDate" type="date" name="annualDueDate" />
        </div>

        <h2>Prodotti associato</h2>
        <div class="affare-grid">
          <label for="productName">Prodotto</label>
          <input id="productName" type="text" name="productName" placeholder="Cerca Prodotto" />

          <label for="productPrice">Prezzo listino (€)</label>
          <input id="productPrice" type="number" name="productPrice" step="0.01" min="0" placeholder="0.00" />

          <label for="productQty">Quantita</label>
          <input id="productQty" type="number" name="productQty" step="1" min="1" value="1" />

          <label for="productDiscount">Sconto (%)</label>
          <input id="productDiscount" type="number" name="productDiscount" step="0.01" min="0" max="100" value="0" />

          <label for="productTotal">Totale (€)</label>
          <input id="productTotal" type="number" name="productTotal" step="0.01" min="0" placeholder="Calcolato o manuale" />
        </div>

        <div class="row-between">
          <select name="serviceId"><option value="">Servizio collegato (opzionale)</option>${serviceOptions}</select>
          <button type="submit">Crea Affare</button>
        </div>
      </form>
    </section>
    <script>
      (function () {
        const data = ${customerJson};
        const select = document.getElementById('customerId');
        const search = document.getElementById('companySearch');
        const inlineCreate = document.getElementById('inlineCustomerCreate');
        const contactName = document.getElementById('contactName');
        const contactEmail = document.getElementById('contactEmail');
        const selectedId = ${selectedCustomerId || 0};

        function syncContactFromCustomer() {
          const val = select.value;
          const customer = data.find((x) => String(x.id) === String(val));
          if (!customer) return;
          if (!contactName.value) contactName.value = customer.contactName || '';
          if (!contactEmail.value) contactEmail.value = customer.email || '';
        }

        function applySearch() {
          const query = (search.value || '').trim().toLowerCase();
          Array.from(select.options).forEach((opt) => {
            if (!opt.value || opt.value === '__new__') return;
            const visible = !query || opt.textContent.toLowerCase().includes(query);
            opt.hidden = !visible;
          });
        }

        if (selectedId) {
          select.value = String(selectedId);
          syncContactFromCustomer();
        }

        select.addEventListener('change', function () {
          if (this.value === '__new__') {
            inlineCreate.setAttribute('open', 'open');
            return;
          }
          inlineCreate.removeAttribute('open');
          syncContactFromCustomer();
        });

        search.addEventListener('input', applySearch);
      })();
    </script>
  `;
  res.send(renderAppLayout('Gestionale - Nuova Commessa', body, req.user, true));
});

app.post('/gestionale/lavori/new', (req, res) => {
  const store = readStore();
  const customerIdRaw = (req.body.customerId || '').toString().trim();
  let customerId = Number(customerIdRaw || 0);

  if (customerIdRaw === '__new__' || !customerId) {
    const company = (req.body.newCustomerCompany || '').trim();
    const firstName = (req.body.newCustomerFirstName || '').trim();
    const lastName = (req.body.newCustomerLastName || '').trim();
    const email = (req.body.newCustomerEmail || '').trim().toLowerCase();
    const phone = (req.body.newCustomerPhone || '').trim();

    if (company && email) {
      const existing = store.customers.find((c) => String(c.email || '').toLowerCase() === email);
      if (existing) {
        customerId = existing.id;
      } else {
        const id = nextId(store.customers);
        store.customers.unshift({
          id,
          company,
          website: '',
          vat: '',
          firstName,
          lastName,
          email,
          phone,
          billingAddress: '',
          pec: '',
          sdi: '',
          status: 'lead',
          wpUserId: null,
          wpUsername: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        customerId = id;
      }
    }
  }

  const title = (req.body.title || '').trim();
  const status = normalizeJobStatus(req.body.status);
  const description = (req.body.description || '').trim();
  if (!title || !customerId) {
    return res.redirect('/gestionale/lavori/new');
  }

  store.jobs.unshift({
    id: nextId(store.jobs),
    title,
    customerId,
    serviceId: Number(req.body.serviceId || 0) || null,
    notes: description,
    description,
    contactName: (req.body.contactName || '').trim(),
    contactEmail: (req.body.contactEmail || '').trim(),
    secondaryContacts: (req.body.secondaryContacts || '').trim(),
    pipelineName: (req.body.pipelineName || '').trim(),
    downPayment: Number(req.body.downPayment || 0),
    remainingBalance: Number(req.body.remainingBalance || 0),
    annualDueDate: (req.body.annualDueDate || '').trim(),
    productName: (req.body.productName || '').trim(),
    productPrice: Number(req.body.productPrice || 0),
    productQty: Number(req.body.productQty || 0),
    productDiscount: Number(req.body.productDiscount || 0),
    productTotal: Number(req.body.productTotal || 0),
    dueDate: (req.body.dueDate || '').trim(),
    amount: Number(req.body.amount || 0),
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  writeStore(store);
  res.redirect('/gestionale/lavori');
});

app.get('/gestionale/lavori/:id', (req, res) => {
  const store = readStore();
  const id = Number(req.params.id || 0);
  const job = store.jobs.find((j) => Number(j.id) === id);
  if (!job) {
    return res.status(404).send(renderPublicPage('Commessa non trovata', '<p>Commessa non trovata.</p>'));
  }
  const customer = store.customers.find((c) => Number(c.id) === Number(job.customerId || 0));
  const service = store.services.find((s) => Number(s.id) === Number(job.serviceId || 0));
  const body = `
    <h1>Scheda lavoro</h1>
    <section class="card">
      <a class="btn-link" href="/gestionale/lavori">← Torna a lavori/commesse</a>
    </section>
    <section class="card">
      <form method="post" action="/gestionale/lavori/${id}/update" class="form-grid two-col">
        <input type="text" value="${esc(customer ? (customer.company || `${customer.firstName} ${customer.lastName}`) : 'Cliente non associato')}" disabled />
        <input type="text" value="${esc(service ? service.name : 'Nessun servizio collegato')}" disabled />

        <input type="text" name="title" placeholder="Nome lavoro" value="${esc(job.title || '')}" required />
        <select name="status" required>
          ${JOB_STATUS_OPTIONS.map((s) => `<option value="${s}" ${job.status === s ? 'selected' : ''}>${esc(labelJobStatus(s))}</option>`).join('')}
        </select>

        <input type="date" name="dueDate" value="${esc((job.dueDate || '').slice(0, 10))}" />
        <input type="number" name="amount" step="0.01" min="0" value="${Number(job.amount || 0).toFixed(2)}" />

        <textarea name="description" rows="4" placeholder="Descrizione / note">${esc(job.description || job.notes || '')}</textarea>
        <textarea name="notes" rows="4" placeholder="Note operative interne">${esc(job.notes || '')}</textarea>

        <button type="submit">Salva modifiche lavoro</button>
      </form>
    </section>
  `;
  res.send(renderAppLayout('Gestionale - Scheda Lavoro', body, req.user, true));
});

app.post('/gestionale/lavori/:id/update', (req, res) => {
  const store = readStore();
  const id = Number(req.params.id || 0);
  const job = store.jobs.find((j) => Number(j.id) === id);
  if (!job) return res.redirect('/gestionale/lavori');

  job.title = (req.body.title || '').trim() || job.title;
  job.status = normalizeJobStatus(req.body.status);
  job.dueDate = (req.body.dueDate || '').trim();
  const amount = Number(req.body.amount || 0);
  if (Number.isFinite(amount)) job.amount = amount;
  job.description = (req.body.description || '').trim();
  job.notes = (req.body.notes || '').trim() || job.description;
  job.updatedAt = new Date().toISOString();

  writeStore(store);
  return res.redirect(`/gestionale/lavori/${id}`);
});

app.post('/gestionale/lavori/:id/status', (req, res) => {
  const store = readStore();
  const id = Number(req.params.id || 0);
  const status = normalizeJobStatus(req.body.status);
  const job = store.jobs.find((j) => Number(j.id) === id);
  if (job) {
    job.status = status;
    job.updatedAt = new Date().toISOString();
    writeStore(store);
  }
  res.redirect(req.get('referer') || '/gestionale/lavori');
});

app.post('/gestionale/lavori/:id/delete', (req, res) => {
  const store = readStore();
  const id = Number(req.params.id || 0);
  store.jobs = store.jobs.filter((j) => Number(j.id) !== id);
  writeStore(store);
  res.redirect(req.get('referer') || '/gestionale/lavori');
});

app.get('/gestionale/rinnovi', (req, res) => {
  const store = readStore();
  const q = (req.query.q || '').toString().trim();
  const payment = (req.query.payment || '').toString().trim();
  const renewals = filterRenewals(chronologicalRenewals(store), store.services, q, payment);
  const body = `
    <h1>Rinnovi</h1>
    <section class="card">
      <h2>Rinnovi in ordine cronologico</h2>
      <form method="get" action="/gestionale/rinnovi" class="filter-grid">
        <input type="text" name="q" value="${esc(q)}" placeholder="Cerca cliente/servizio" />
        <select name="payment">
          <option value="">Stato pagamento: tutti</option>
          <option value="pending" ${payment === 'pending' ? 'selected' : ''}>In attesa</option>
          <option value="paid" ${payment === 'paid' ? 'selected' : ''}>Pagato</option>
        </select>
        <button type="submit">Filtra</button>
      </form>
      ${renderRenewalsTable(renewals, store.services, store.customers, true)}
    </section>
  `;
  res.send(renderAppLayout('Gestionale - Rinnovi', body, req.user, true));
});

app.post('/gestionale/abbonamenti/:id/price', (req, res) => {
  const store = readStore();
  const id = Number(req.params.id || 0);
  const sub = store.subscriptions.find((s) => Number(s.id) === id);
  if (sub) {
    const price = Number(req.body.priceAtSale || 0);
    sub.priceAtSale = Number.isFinite(price) ? price : Number(sub.priceAtSale || 0);
    sub.updatedAt = new Date().toISOString();
    writeStore(store);
  }
  res.redirect(req.get('referer') || '/gestionale/rinnovi');
});

app.post('/gestionale/rinnovi/:id/payment', (req, res) => {
  const store = readStore();
  const id = Number(req.params.id || 0);
  const sub = store.subscriptions.find((s) => Number(s.id) === id);
  if (sub) {
    const payment = req.body.paymentStatus === 'paid' ? 'paid' : 'pending';
    sub.paymentStatus = payment;
    if (payment === 'paid' && sub.billingType === 'subscription' && sub.renewalDate) {
      sub.lastPaidAt = new Date().toISOString().slice(0, 10);
      sub.renewalDate = computeRenewalDate(sub.renewalDate, sub.billingInterval || 'annual');
      sub.paymentStatus = 'pending';
    }
    sub.updatedAt = new Date().toISOString();
    writeStore(store);
  }
  res.redirect(req.get('referer') || '/gestionale/rinnovi');
});

app.get('/gestionale/ticket', (req, res) => {
  const store = readStore();
  const body = `
    <h1>Ticket</h1>
    <section class="card">
      <h2>Lista ticket</h2>
      ${renderAdminTickets(store.tickets, store.customers)}
    </section>
  `;
  res.send(renderAppLayout('Gestionale - Ticket', body, req.user, true));
});

app.post('/gestionale/ticket/:id/status', (req, res) => {
  const id = Number(req.params.id || 0);
  const status = ['open', 'in_progress', 'closed'].includes(req.body.status) ? req.body.status : 'open';
  const store = readStore();
  const ticket = store.tickets.find((t) => t.id === id);
  if (ticket) {
    ticket.status = status;
    writeStore(store);
  }
  res.redirect('/gestionale/ticket');
});

cron.schedule('0 9 * * *', async () => {
  await sendRenewalReminders();
});

app.get('/', (_req, res) => res.redirect('/areapersonale'));

app.listen(PORT, () => {
  console.log(`EDA manager app listening on :${PORT}`);
});

function authMiddleware(req, res, next) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) {
    return redirectToWpLogin(req, res);
  }
  try {
    req.user = jwt.verify(token, EDA_SSO_SECRET);
    return next();
  } catch (_e) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return redirectToWpLogin(req, res);
  }
}

function requireAdmin(req, res, next) {
  const roles = Array.isArray(req.user.roles) ? req.user.roles : [];
  const isAdmin = roles.includes('administrator');
  if (!isAdmin) {
    return res.status(403).send(renderPublicPage('Accesso negato', '<p>Area riservata amministratore.</p>'));
  }
  return next();
}

function redirectToWpLogin(req, res) {
  if (!WP_BASE_URL) {
    return res.status(500).send('WP_BASE_URL non configurato');
  }
  const next = sanitizeNext(req.originalUrl || '/areapersonale');
  const url = `${WP_BASE_URL}/wp-json/eda-auth/v1/sso-start?next=${encodeURIComponent(next)}`;
  return res.redirect(url);
}

function sanitizeNext(next) {
  if (typeof next !== 'string') return '/areapersonale';
  if (next.startsWith('/gestionale') || next.startsWith('/areapersonale')) return next;
  return '/areapersonale';
}

function sanitizeManagerReturn(next, fallback = '/gestionale/clienti') {
  if (typeof next !== 'string') return fallback;
  if (next === '/gestionale/lavori/new' || next === '/gestionale/clienti' || next.startsWith('/gestionale/clienti/')) return next;
  return fallback;
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify(emptyStore(), null, 2), 'utf8');
  }
}

function emptyStore() {
  return { services: [], customers: [], invites: [], subscriptions: [], tickets: [], jobs: [] };
}

function readStore() {
  ensureStore();
  const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  return normalizeStore(raw);
}

function normalizeStore(store) {
  const s = store || {};
  if (!Array.isArray(s.services)) s.services = [];
  if (!Array.isArray(s.customers)) s.customers = [];
  if (!Array.isArray(s.invites)) s.invites = [];
  if (!Array.isArray(s.subscriptions)) s.subscriptions = [];
  if (!Array.isArray(s.tickets)) s.tickets = [];
  if (!Array.isArray(s.jobs)) s.jobs = [];

  for (const sub of s.subscriptions) {
    if (!sub.customerId) {
      let customer = s.customers.find((c) => String(c.email || '').toLowerCase() === String(sub.email || '').toLowerCase());
      if (!customer && sub.email) {
        customer = {
          id: nextId(s.customers),
          company: sub.company || '',
          website: '',
          vat: '',
          firstName: sub.customerName || '',
          lastName: '',
          email: sub.email,
          phone: '',
          billingAddress: '',
          pec: '',
          sdi: '',
          status: sub.wpUserId ? 'active' : 'invited',
          wpUserId: sub.wpUserId || null,
          wpUsername: '',
          createdAt: sub.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        s.customers.push(customer);
      }
      if (customer) sub.customerId = customer.id;
    }
    if (!sub.billingType) sub.billingType = sub.renewalDate ? 'subscription' : 'one_time';
    if (!sub.billingInterval) sub.billingInterval = 'annual';
    if (!sub.paymentStatus) sub.paymentStatus = 'pending';
    if (typeof sub.priceAtSale === 'undefined') sub.priceAtSale = 0;
  }

  for (const job of s.jobs) {
    if (!job.status) job.status = 'qualificazione_preventivo';
    job.status = normalizeJobStatus(job.status);
  }

  for (const customer of s.customers) {
    if (!Array.isArray(customer.notes)) customer.notes = [];
    if (!customer.website) customer.website = '';
    if (!Array.isArray(customer.payments)) customer.payments = [];
  }

  return s;
}

function writeStore(data) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function nextId(arr) {
  return arr.length ? Math.max(...arr.map((x) => Number(x.id) || 0)) + 1 : 1;
}

function chronologicalRenewals(store) {
  return store.subscriptions
    .filter((s) => s.renewalDate)
    .sort((a, b) => String(a.renewalDate).localeCompare(String(b.renewalDate)));
}

function upcomingRenewals(store, days) {
  const now = new Date();
  const max = new Date(now.getTime() + days * 86400000);
  return store.subscriptions
    .filter((s) => {
      if (!s.renewalDate || s.status !== 'active' || s.billingType !== 'subscription') return false;
      const d = new Date(`${s.renewalDate}T00:00:00`);
      return d >= new Date(now.toDateString()) && d <= max;
    })
    .sort((a, b) => String(a.renewalDate).localeCompare(String(b.renewalDate)));
}

function esc(v) {
  return String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateItShort(v) {
  const raw = String(v || '').trim();
  if (!raw || raw === '-') return '-';
  const datePart = raw.includes('T') ? raw.slice(0, 10) : raw.slice(0, 10);
  const m = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw;
  return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
}

function computeExpectedAnnualTotal(subs, year) {
  return subs.reduce((sum, s) => {
    const status = String(s.status || '').toLowerCase();
    if (status === 'cancelled') return sum;
    const billingType = String(s.billingType || '');
    if (billingType === 'subscription') {
      const refDate = String(s.renewalDate || s.purchaseDate || '').slice(0, 10);
      if (!refDate) return sum;
      const y = Number(refDate.slice(0, 4) || 0);
      if (y !== Number(year)) return sum;
      return sum + Number(s.priceAtSale || 0);
    }
    const purchase = String(s.purchaseDate || '').slice(0, 10);
    const y = Number(purchase.slice(0, 4) || 0);
    if (y !== Number(year)) return sum;
    return sum + Number(s.priceAtSale || 0);
  }, 0);
}

function kpi(label, value) {
  return `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div></div>`;
}

function labelBilling(type, interval) {
  if (type !== 'subscription') return 'Una tantum';
  if (interval === 'monthly') return 'Abbonamento mensile';
  if (interval === 'semiannual') return 'Abbonamento semestrale';
  return 'Abbonamento annuale';
}

function labelJobStatus(v) {
  const map = {
    qualificazione_preventivo: 'Qualificazione e preventivo',
    scrittura_preventivo: 'Scrittura preventivo',
    in_lavorazione: 'In lavorazione',
    in_attesa_pagamento: 'In attesa di pagamento',
    gestione_annuale: 'Gestione annuale',
    chiusa_acquisita: 'Chiusa e acquisita',
    chiusa_persa: 'Chiusa e persa'
  };
  return map[v] || v;
}

function normalizeJobStatus(v) {
  const legacyMap = {
    aperta: 'qualificazione_preventivo',
    call_fissata: 'qualificazione_preventivo',
    preventivo_inviato: 'scrittura_preventivo',
    attiva: 'in_lavorazione'
  };
  const value = String(v || 'qualificazione_preventivo');
  if (legacyMap[value]) return legacyMap[value];
  return JOB_STATUS_OPTIONS.includes(value) ? value : 'qualificazione_preventivo';
}

function filterCustomers(customers, q, status) {
  const query = String(q || '').toLowerCase();
  return customers.filter((c) => {
    if (status && c.status !== status) return false;
    if (!query) return true;
    const blob = `${c.company || ''} ${c.firstName || ''} ${c.lastName || ''} ${c.email || ''} ${c.phone || ''}`.toLowerCase();
    return blob.includes(query);
  });
}

function filterJobs(jobs, customers, services, q, status) {
  const query = String(q || '').toLowerCase();
  return jobs.filter((j) => {
    if (status && j.status !== status) return false;
    if (!query) return true;
    const customer = customers.find((c) => Number(c.id) === Number(j.customerId || 0));
    const service = services.find((s) => Number(s.id) === Number(j.serviceId || 0));
    const blob = `${j.title || ''} ${j.notes || ''} ${customer?.company || ''} ${customer?.email || ''} ${service?.name || ''}`.toLowerCase();
    return blob.includes(query);
  });
}

function filterRenewals(rows, services, q, payment) {
  const query = String(q || '').toLowerCase();
  return rows.filter((r) => {
    if (payment && ((r.paymentStatus === 'paid' ? 'paid' : 'pending') !== payment)) return false;
    if (!query) return true;
    const service = services.find((s) => Number(s.id) === Number(r.serviceId || 0));
    const blob = `${r.company || ''} ${r.customerName || ''} ${r.email || ''} ${service?.name || ''}`.toLowerCase();
    return blob.includes(query);
  });
}

function importCrmCsvData(store, input) {
  const companiesCsvText = typeof input.companiesCsvText === 'string' ? input.companiesCsvText : '';
  const contactsCsvText = typeof input.contactsCsvText === 'string' ? input.contactsCsvText : '';
  const pipelinesCsvText = typeof input.pipelinesCsvText === 'string' ? input.pipelinesCsvText : '';
  const companiesPath = String(input.companiesPath || '').trim();
  const contactsPath = String(input.contactsPath || '').trim();
  const pipelinesPath = String(input.pipelinesPath || '').trim();

  const companiesRows = companiesCsvText
    ? parseCsvObjectsFromText('companies.csv', companiesCsvText)
    : parseCsvObjects(companiesPath);
  const contactsRows = contactsCsvText
    ? parseCsvObjectsFromText('contacts.csv', contactsCsvText)
    : parseCsvObjects(contactsPath);
  const pipelinesRows = pipelinesCsvText
    ? parseCsvObjectsFromText('pipelines.csv', pipelinesCsvText)
    : parseCsvObjects(pipelinesPath);

  if (input.replaceExisting) {
    store.customers = [];
    store.jobs = [];
    store.subscriptions = [];
  }

  const annualService = ensureAnnualManagementService(store);

  const customersByCrmCompanyId = new Map();
  const contactsByCrmContactId = new Map();
  const contactsByCrmCompanyId = new Map();

  for (const c of contactsRows) {
    const contactId = String(c['Contact Id'] || '').trim();
    const companyId = String(c['Nome Società.id'] || '').trim();
    const contact = {
      contactId,
      companyId,
      firstName: String(c.Nome || '').trim(),
      lastName: String(c.Cognome || '').trim(),
      fullName: String(c['Contact Name'] || `${c.Nome || ''} ${c.Cognome || ''}`).trim(),
      email: String(c['E-mail'] || '').trim().toLowerCase(),
      mobile: String(c.Cellulare || '').trim(),
      phone: String(c.Telefono || '').trim()
    };
    if (contactId) contactsByCrmContactId.set(contactId, contact);
    if (companyId) {
      if (!contactsByCrmCompanyId.has(companyId)) contactsByCrmCompanyId.set(companyId, []);
      contactsByCrmCompanyId.get(companyId).push(contact);
    }
  }

  let customersUpserted = 0;
  let contactsLinked = 0;
  let jobsUpserted = 0;

  for (const row of companiesRows) {
    const crmCompanyId = String(row['Company Id'] || '').trim();
    const company = String(row['Nome Società'] || '').trim();
    const contactsForCompany = contactsByCrmCompanyId.get(crmCompanyId) || [];
    const primaryContact = contactsForCompany[0] || null;
    const email = String((primaryContact?.email || row['Email Contatto'] || '')).trim().toLowerCase();
    const phone = String((primaryContact?.mobile || primaryContact?.phone || row.Telefono || '')).trim();

    let customer = store.customers.find((c) => String(c.crmCompanyId || '') === crmCompanyId);
    if (!customer && email) {
      customer = store.customers.find((c) => String(c.email || '').toLowerCase() === email);
    }
    if (!customer && company) {
      customer = store.customers.find((c) => String(c.company || '').toLowerCase() === company.toLowerCase());
    }

    const firstName = String(primaryContact?.firstName || '').trim();
    const lastName = String(primaryContact?.lastName || '').trim();
    const now = new Date().toISOString();
    if (!customer) {
      customer = {
        id: nextId(store.customers),
        company,
        website: String(row['Sito Web'] || '').trim(),
        vat: String(row.PIVA || '').trim(),
        firstName,
        lastName,
        email,
        phone,
        billingAddress: String(row['Via fatturazione'] || '').trim(),
        pec: String(row.pec || '').trim(),
        sdi: String(row.SDI || '').trim(),
        status: 'lead',
        wpUserId: null,
        wpUsername: '',
        crmCompanyId,
        crmPrimaryContactId: primaryContact?.contactId || '',
        crmContacts: contactsForCompany.map((x) => ({ id: x.contactId, name: x.fullName, email: x.email })),
        createdAt: normalizeDateTime(row['Ora creazione']) || now,
        updatedAt: normalizeDateTime(row['Ora modifica']) || now,
        notes: []
      };
      store.customers.unshift(customer);
    } else {
      customer.company = company || customer.company;
      customer.website = String(row['Sito Web'] || customer.website || '').trim();
      customer.vat = String(row.PIVA || customer.vat || '').trim();
      customer.firstName = firstName || customer.firstName;
      customer.lastName = lastName || customer.lastName;
      customer.email = email || customer.email;
      customer.phone = phone || customer.phone;
      customer.billingAddress = String(row['Via fatturazione'] || customer.billingAddress || '').trim();
      customer.pec = String(row.pec || customer.pec || '').trim();
      customer.sdi = String(row.SDI || customer.sdi || '').trim();
      customer.crmCompanyId = crmCompanyId || customer.crmCompanyId || '';
      customer.crmPrimaryContactId = primaryContact?.contactId || customer.crmPrimaryContactId || '';
      customer.crmContacts = contactsForCompany.map((x) => ({ id: x.contactId, name: x.fullName, email: x.email }));
      customer.updatedAt = normalizeDateTime(row['Ora modifica']) || now;
      if (!Array.isArray(customer.notes)) customer.notes = [];
    }
    customersUpserted += 1;
    contactsLinked += contactsForCompany.length;
    if (crmCompanyId) customersByCrmCompanyId.set(crmCompanyId, customer);
  }

  for (const row of contactsRows) {
    const crmContactId = String(row['Contact Id'] || '').trim();
    const companyId = String(row['Nome Società.id'] || '').trim();
    const linkedCustomer = companyId ? customersByCrmCompanyId.get(companyId) : null;
    if (linkedCustomer && !Array.isArray(linkedCustomer.crmContacts)) linkedCustomer.crmContacts = [];
    if (linkedCustomer && crmContactId && !linkedCustomer.crmContacts.find((x) => x.id === crmContactId)) {
      linkedCustomer.crmContacts.push({
        id: crmContactId,
        name: String(row['Contact Name'] || `${row.Nome || ''} ${row.Cognome || ''}`).trim(),
        email: String(row['E-mail'] || '').trim().toLowerCase()
      });
      contactsLinked += 1;
    }
  }

  for (const row of pipelinesRows) {
    const crmDealId = String(row['Affare Id'] || '').trim();
    const crmCompanyId = String(row['Nome Società.id'] || '').trim();
    const crmContactId = String(row['Nome Contatto.id'] || '').trim();
    const contact = contactsByCrmContactId.get(crmContactId);

    let customer = crmCompanyId ? customersByCrmCompanyId.get(crmCompanyId) : null;
    if (!customer) {
      const companyName = String(row['Nome Società'] || '').trim();
      if (companyName) customer = store.customers.find((c) => String(c.company || '').toLowerCase() === companyName.toLowerCase()) || null;
    }
    if (!customer && contact?.email) {
      customer = store.customers.find((c) => String(c.email || '').toLowerCase() === String(contact.email || '').toLowerCase()) || null;
    }
    if (!customer) {
      const fullName = String(row['Nome Contatto'] || contact?.fullName || '').trim();
      const [firstName, ...rest] = fullName.split(' ');
      const lastName = rest.join(' ').trim();
      customer = {
        id: nextId(store.customers),
        company: String(row['Nome Società'] || fullName || 'Cliente importato').trim(),
        website: String(row['sito attuale'] || '').trim(),
        vat: '',
        firstName: String(firstName || '').trim(),
        lastName: String(lastName || '').trim(),
        email: String((contact?.email || '')).trim().toLowerCase(),
        phone: String((contact?.mobile || contact?.phone || '')).trim(),
        billingAddress: '',
        pec: '',
        sdi: '',
        status: 'lead',
        wpUserId: null,
        wpUsername: '',
        crmCompanyId,
        crmPrimaryContactId: crmContactId,
        crmContacts: contact ? [{ id: contact.contactId, name: contact.fullName, email: contact.email }] : [],
        createdAt: normalizeDateTime(row['Ora creazione']) || new Date().toISOString(),
        updatedAt: normalizeDateTime(row['Ora modifica']) || new Date().toISOString(),
        notes: []
      };
      store.customers.unshift(customer);
      customersUpserted += 1;
      if (crmCompanyId) customersByCrmCompanyId.set(crmCompanyId, customer);
    }

    let job = store.jobs.find((j) => String(j.crmDealId || '') === crmDealId);
    const payload = {
      title: String(row['Nome Affare'] || '').trim() || 'Affare importato',
      customerId: customer.id,
      serviceId: null,
      notes: String(row.Descrizione || '').trim(),
      description: String(row.Descrizione || '').trim(),
      contactName: String(row['Nome Contatto'] || contact?.fullName || '').trim(),
      contactEmail: String(contact?.email || customer.email || '').trim().toLowerCase(),
      secondaryContacts: '',
      pipelineName: String(row['Pipeline secondaria'] || row.Pipeline || '').trim(),
      downPayment: normalizeMoney(row['Anticipo versato']),
      remainingBalance: normalizeMoney(row['Saldo mancante']),
      annualDueDate: normalizeDate(row['Scadenza gestione annuale']),
      productName: '',
      productPrice: 0,
      productQty: 0,
      productDiscount: 0,
      productTotal: 0,
      dueDate: normalizeDate(row['Data di chiusura']),
      amount: normalizeMoney(row.Valore),
      status: phaseToJobStatus(row.Fase),
      crmDealId,
      crmCompanyId,
      crmContactId,
      createdAt: normalizeDateTime(row['Ora creazione']) || new Date().toISOString(),
      updatedAt: normalizeDateTime(row['Ora modifica']) || new Date().toISOString()
    };

    if (!job) {
      store.jobs.unshift({
        id: nextId(store.jobs),
        ...payload
      });
    } else {
      Object.assign(job, payload);
    }
    jobsUpserted += 1;

    if (payload.status === 'gestione_annuale') {
      upsertAnnualSubscriptionFromDeal(store, annualService, customer, row, contact, crmDealId);
    }
  }

  return { customersUpserted, contactsLinked, jobsUpserted };
}

function ensureAnnualManagementService(store) {
  let service = store.services.find((s) => String(s.name || '').toLowerCase() === 'gestione annuale');
  if (service) return service;

  service = {
    id: nextId(store.services),
    name: 'Gestione annuale',
    description: 'Servizio annuale ricorrente',
    price: 0,
    billingType: 'subscription',
    billingInterval: 'annual',
    active: true,
    createdAt: new Date().toISOString()
  };
  store.services.unshift(service);
  return service;
}

function upsertAnnualSubscriptionFromDeal(store, annualService, customer, row, contact, crmDealId) {
  const purchaseDate = normalizeDate(row['Data di chiusura']) || normalizeDateTime(row['Ora creazione']).slice(0, 10) || new Date().toISOString().slice(0, 10);
  const customPrice = normalizeMoney(row.Valore);
  const priceAtSale = customPrice > 0 ? customPrice : Number(annualService.price || 0);
  const dealContactName = String(row['Nome Contatto'] || contact?.fullName || `${customer.firstName || ''} ${customer.lastName || ''}`).trim();
  const dealContactEmail = String(contact?.email || customer.email || '').trim().toLowerCase();

  let sub = store.subscriptions.find((s) => String(s.crmDealId || '') === crmDealId);
  if (!sub) {
    sub = store.subscriptions.find((s) =>
      Number(s.customerId || 0) === Number(customer.id) &&
      Number(s.serviceId || 0) === Number(annualService.id) &&
      String(s.purchaseDate || '') === purchaseDate
    );
  }

  const payload = {
    customerId: customer.id,
    wpUserId: customer.wpUserId || null,
    customerName: dealContactName,
    company: customer.company,
    email: dealContactEmail,
    serviceId: annualService.id,
    purchaseDate,
    renewalDate: computeRenewalDate(purchaseDate, 'annual'),
    billingType: 'subscription',
    billingInterval: 'annual',
    priceAtSale,
    status: 'active',
    paymentStatus: 'pending',
    notes: String(row.Descrizione || '').trim(),
    lastReminderSent: '',
    crmDealId,
    updatedAt: normalizeDateTime(row['Ora modifica']) || new Date().toISOString()
  };

  if (!sub) {
    store.subscriptions.unshift({
      id: nextId(store.subscriptions),
      ...payload,
      createdAt: normalizeDateTime(row['Ora creazione']) || new Date().toISOString()
    });
  } else {
    Object.assign(sub, payload);
  }
}

function parseCsvObjects(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File non trovato: ${filePath}`);
  const text = fs.readFileSync(filePath, 'utf8');
  return parseCsvObjectsFromText(filePath, text);
}

function parseCsvObjectsFromText(sourceName, text) {
  const normalizedText = String(text || '').replace(/^\uFEFF/, '');
  const rows = parseCsvRows(normalizedText);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h || '').trim());
  if (!headers.length) {
    throw new Error(`CSV non valido (${sourceName})`);
  }
  return rows.slice(1).map((cells) => {
    const obj = {};
    for (let i = 0; i < headers.length; i += 1) {
      obj[headers[i]] = String(cells[i] || '').trim();
    }
    return obj;
  });
}

function parseCsvRows(input) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];

    if (ch === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (ch === ',' && !quoted) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell);
      const hasValue = row.some((x) => String(x || '').trim() !== '');
      if (hasValue) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    const hasValue = row.some((x) => String(x || '').trim() !== '');
    if (hasValue) rows.push(row);
  }

  return rows;
}

function normalizeDate(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return raw;
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

function normalizeDateTime(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const isoCandidate = raw.includes(' ') ? raw.replace(' ', 'T') : raw;
  const dt = new Date(isoCandidate);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString();
}

function normalizeMoney(v) {
  const raw = String(v || '').trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function phaseToJobStatus(phase) {
  const key = String(phase || '').trim().toLowerCase();
  const map = {
    'qualificazione e preventivo': 'qualificazione_preventivo',
    'scrittura preventivo': 'scrittura_preventivo',
    'in lavorazione': 'in_lavorazione',
    'in attesa di pagamento': 'in_attesa_pagamento',
    'gestione annuale': 'gestione_annuale',
    'chiusa e acquisita': 'chiusa_acquisita',
    'chiusa persa': 'chiusa_persa'
  };
  return map[key] || 'qualificazione_preventivo';
}

function renderServiceForm(action) {
  return `<form method="post" action="${esc(action)}" class="form-grid two-col">
    <input name="name" type="text" placeholder="Nome servizio" required />
    <textarea name="description" rows="3" placeholder="Descrizione"></textarea>
    <input name="price" type="number" step="0.01" min="0" placeholder="Prezzo" required />
    <select name="billingType">
      <option value="one_time">Una tantum</option>
      <option value="subscription">Abbonamento</option>
    </select>
    <select name="billingInterval">
      <option value="monthly">Mensile</option>
      <option value="semiannual">Semestrale</option>
      <option value="annual">Annuale</option>
    </select>
    <button type="submit">Salva servizio</button>
  </form>`;
}

function createServiceFromRequest(store, body) {
  const name = (body.name || '').trim();
  if (!name) return null;
  const service = {
    id: nextId(store.services),
    name,
    description: (body.description || '').trim(),
    price: Number(body.price || 0),
    billingType: body.billingType === 'subscription' ? 'subscription' : 'one_time',
    billingInterval: normalizeInterval(body.billingInterval || 'annual'),
    active: true,
    createdAt: new Date().toISOString()
  };
  store.services.unshift(service);
  return service;
}

function resolveServiceForAssignment(store, body) {
  let serviceId = Number(body.serviceId || 0);
  if (serviceId) return serviceId;

  const created = createServiceFromRequest(store, {
    name: body.newServiceName,
    price: body.newServicePrice,
    billingType: body.newServiceBillingType,
    billingInterval: body.newServiceBillingInterval
  });
  if (!created) return 0;
  return created.id;
}

function deriveBillingType(override, fallback) {
  if (override === 'one_time' || override === 'subscription') return override;
  return fallback === 'subscription' ? 'subscription' : 'one_time';
}

function deriveBillingInterval(override, fallback) {
  if (override === 'monthly' || override === 'semiannual' || override === 'annual') return override;
  return normalizeInterval(fallback);
}

function normalizeInterval(v) {
  if (v === 'monthly' || v === 'semiannual' || v === 'annual') return v;
  return 'annual';
}

function computeRenewalDate(startDate, interval) {
  const d = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const months = interval === 'monthly' ? 1 : interval === 'semiannual' ? 6 : 12;
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

function addDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function makeUsername(email, displayName) {
  const fromEmail = String(email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9._-]+/g, '.');
  const fromName = String(displayName || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '.');
  const base = (fromEmail || fromName || `user.${Date.now()}`).replace(/^\.+|\.+$/g, '').slice(0, 32);
  return base || `user.${Date.now()}`;
}

function maybeSendInviteEmail(customer, invite, inviteUrl) {
  if (!(SMTP_HOST && SMTP_USER && SMTP_PASS && SMTP_FROM)) return;

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 7000,
    greetingTimeout: 7000,
    socketTimeout: 10000
  });

  const subject = '[Easy Digital Agency] Completa la tua registrazione';
  const text = `Ciao ${customer.firstName},\n\nPer completare la registrazione alla tua area personale usa questo link:\n${inviteUrl}\n\nIl link scade il ${invite.expiresAt.slice(0, 10)}.\n\nEasy Digital Agency`;

  Promise.race([
    transporter.sendMail({ from: SMTP_FROM, to: customer.email, subject, text }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP timeout')), 12000))
  ]).catch((e) => {
    console.error('Invite mail error:', e.message);
  });
}

function renderServicesTable(services) {
  if (!services.length) return '<p>Nessun servizio in catalogo.</p>';
  const rows = services
    .map((s) => `<tr><td>${s.id}</td><td>${esc(s.name)}</td><td>€ ${Number(s.price || 0).toFixed(2)}</td><td>${esc(labelBilling(s.billingType, s.billingInterval))}</td></tr>`)
    .join('');
  return `<table class="tbl"><thead><tr><th>ID</th><th>Servizio</th><th>Prezzo</th><th>Tipo</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderCustomersTable(store, customersOverride = null) {
  const customers = Array.isArray(customersOverride) ? customersOverride : store.customers;
  if (!customers.length) return '<p>Nessun cliente.</p>';

  const rows = customers.map((c) => {
    const invite = store.invites.find((i) => i.customerId === c.id && i.status === 'pending');
    const inviteLink = invite ? `${WP_BASE_URL}/areapersonale/invito?token=${invite.token}` : '';
    return `<tr>
      <td><a href="/gestionale/clienti/${c.id}">${esc(c.company || '-')}</a></td>
      <td>${esc(`${c.firstName} ${c.lastName}`.trim())}</td>
      <td>${esc(c.email)}</td>
      <td>${esc(c.phone || '-')}</td>
      <td>${c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener">${esc(c.website)}</a>` : '-'}</td>
      <td>${esc(c.vat || '-')}</td>
      <td>${esc(c.status)}</td>
      <td>${inviteLink ? `<button type="button" class="copy-btn" data-copy="${esc(inviteLink)}" title="Copia link invito">📋 Copia</button>` : '-'}</td>
      <td>
        <form method="post" action="/gestionale/clienti/${c.id}/delete" onsubmit="return confirm('Eliminare azienda e dati collegati?');">
          <button type="submit" class="danger-btn ghost">Elimina</button>
        </form>
      </td>
    </tr>`;
  }).join('');

  return `<table class="tbl"><thead><tr><th>Azienda</th><th>Referente</th><th>Email</th><th>Telefono</th><th>Sito web</th><th>P.IVA</th><th>Stato</th><th>Link invito</th><th>Azioni</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderSubscriptionsTableForAdmin(subs, services, withActions = false) {
  if (!subs.length) return '<p>Nessun servizio associato.</p>';
  const rows = subs.map((s) => {
    const srv = services.find((x) => x.id === s.serviceId);
    const actionCell = withActions
      ? `<form method="post" action="/gestionale/abbonamenti/${s.id}/price" class="inline-actions">
          <input type="number" name="priceAtSale" step="0.01" min="0" value="${Number(s.priceAtSale || 0).toFixed(2)}" />
          <button type="submit">Aggiorna importo</button>
        </form>`
      : esc(s.status || '-');
    return `<tr>
      <td>${esc(srv ? srv.name : 'N/A')}</td>
      <td>${esc(labelBilling(s.billingType, s.billingInterval))}</td>
      <td>${esc(formatDateItShort(s.purchaseDate || '-'))}</td>
      <td>${esc(formatDateItShort(s.renewalDate || '-'))}</td>
      <td>€ ${Number(s.priceAtSale || 0).toFixed(2)}</td>
      <td>${actionCell}</td>
    </tr>`;
  }).join('');

  return `<table class="tbl"><thead><tr><th>Servizio</th><th>Tipo</th><th>Attivazione</th><th>Rinnovo</th><th>Importo</th><th>Azione</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderSubscriptionsTable(subs) {
  if (!subs.length) return '<p>Non risultano servizi associati al tuo account.</p>';
  const rows = subs
    .map((s) => `<tr><td>${esc(s.serviceName)}</td><td>${esc(labelBilling(s.billingType, s.billingInterval))}</td><td>€ ${Number(s.price || 0).toFixed(2)}</td><td>${esc(s.purchaseDate)}</td><td>${esc(s.renewalDate || '-')}</td><td>${esc(s.status)}</td></tr>`)
    .join('');
  return `<table class="tbl"><thead><tr><th>Servizio</th><th>Tipo</th><th>Prezzo</th><th>Attivazione</th><th>Rinnovo</th><th>Stato</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderCustomerSnapshot(customer) {
  return `<section class="card">
    <h2>Dati anagrafici</h2>
    <p><strong>Azienda:</strong> ${esc(customer.company || '-')}</p>
    <p><strong>Sito web:</strong> ${customer.website ? `<a href="${esc(customer.website)}" target="_blank" rel="noopener">${esc(customer.website)}</a>` : '-'}</p>
    <p><strong>Referente:</strong> ${esc(`${customer.firstName} ${customer.lastName}`.trim())}</p>
    <p><strong>Email:</strong> ${esc(customer.email)}</p>
    <p><strong>Telefono:</strong> ${esc(customer.phone || '-')}</p>
    <p><strong>P.IVA:</strong> ${esc(customer.vat || '-')}</p>
  </section>`;
}

function renderTicketsTable(tickets) {
  if (!tickets.length) return '<p>Nessun ticket ancora aperto.</p>';
  const rows = tickets.map((t) => `<tr><td>${esc(t.subject)}</td><td>${esc(t.status)}</td><td>${esc((t.createdAt || '').slice(0, 10))}</td></tr>`).join('');
  return `<table class="tbl"><thead><tr><th>Oggetto</th><th>Stato</th><th>Data</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderAdminTickets(tickets, customers) {
  if (!tickets.length) return '<p>Nessun ticket.</p>';
  const rows = tickets.map((t) => {
    const customer = customers.find((c) => Number(c.id) === Number(t.customerId || 0));
    const customerLabel = customer ? `${customer.company || ''} (${customer.email})` : t.email;
    return `
    <tr>
      <td>${t.id}</td><td>${esc(customerLabel)}</td><td>${esc(t.subject)}</td><td>${esc(t.status)}</td>
      <td>
        <form method="post" action="/gestionale/ticket/${t.id}/status" style="display:flex;gap:8px;align-items:center">
          <select name="status">
            <option value="open" ${t.status === 'open' ? 'selected' : ''}>Open</option>
            <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>In progress</option>
            <option value="closed" ${t.status === 'closed' ? 'selected' : ''}>Closed</option>
          </select>
          <button type="submit">Aggiorna</button>
        </form>
      </td>
    </tr>
  `;
  }).join('');
  return `<table class="tbl"><thead><tr><th>ID</th><th>Cliente</th><th>Oggetto</th><th>Stato</th><th>Azione</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderRenewalsTable(rows, services, customers = [], withActions = false) {
  if (!rows.length) return '<p>Nessun rinnovo.</p>';
  const htmlRows = rows.map((r) => {
    const srv = services.find((s) => s.id === r.serviceId);
    const customer = customers.find((c) => Number(c.id) === Number(r.customerId || 0));
    const customerLabel = esc(r.company || r.customerName || '-');
    const customerCell = customer ? `<a href="/gestionale/clienti/${customer.id}">${customerLabel}</a>` : customerLabel;
    const paymentLabel = r.paymentStatus === 'paid' ? 'Pagato' : 'In attesa';
    const actionCell = withActions
      ? `<div class="inline-actions">
          <form method="post" action="/gestionale/abbonamenti/${r.id}/price" class="inline-actions">
            <input type="number" name="priceAtSale" step="0.01" min="0" value="${Number(r.priceAtSale || 0).toFixed(2)}" />
            <button type="submit">Importo</button>
          </form>
          <form method="post" action="/gestionale/rinnovi/${r.id}/payment" class="inline-actions">
            <select name="paymentStatus">
              <option value="pending" ${r.paymentStatus !== 'paid' ? 'selected' : ''}>In attesa</option>
              <option value="paid" ${r.paymentStatus === 'paid' ? 'selected' : ''}>Pagato</option>
            </select>
            <button type="submit">Pagamento</button>
          </form>
        </div>`
      : paymentLabel;
    return `<tr><td>${esc(formatDateItShort(r.renewalDate || '-'))}</td><td>${customerCell}</td><td>${esc(srv ? srv.name : 'N/A')}</td><td>${esc(labelBilling(r.billingType, r.billingInterval))}</td><td>€ ${Number(r.priceAtSale || 0).toFixed(2)}</td><td>${esc(r.status)}</td><td>${actionCell}</td></tr>`;
  }).join('');
  return `<table class="tbl"><thead><tr><th>Data</th><th>Cliente</th><th>Servizio</th><th>Tipo</th><th>Importo</th><th>Stato</th><th>Azione</th></tr></thead><tbody>${htmlRows}</tbody></table>`;
}

function renderPipeline(currentStage) {
  const items = JOB_STATUS_OPTIONS
    .map((s, idx) => {
      const active = s === currentStage ? 'is-current' : '';
      return `<div class="crm-step ${active}"><span class="crm-step-dot">${idx + 1}</span><span>${esc(labelJobStatus(s))}</span></div>`;
    })
    .join('');
  return `<div class="crm-steps">${items}</div>`;
}

function renderJobsTimeline(jobs) {
  if (!jobs.length) return '<p>Nessuna attivita timeline disponibile.</p>';
  const rows = [...jobs]
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
    .map((j) => `<li><strong>${esc(labelJobStatus(j.status))}</strong> · ${esc(j.title)} <span class="muted">(${esc((j.updatedAt || j.createdAt || '').slice(0, 10))})</span></li>`)
    .join('');
  return `<ul class="crm-timeline">${rows}</ul>`;
}

function renderCustomerNotes(notes) {
  if (!notes.length) return '<p class="muted" style="margin-top:12px">Questo record non ha note.</p>';
  const rows = notes
    .map((n) => `<div class="crm-note"><div class="muted">${esc((n.createdAt || '').slice(0, 10))}</div><div>${esc(n.text)}</div></div>`)
    .join('');
  return `<div class="crm-notes-list">${rows}</div>`;
}

function renderJobsTable(jobs, customers, services, includeActions) {
  if (!jobs.length) return '<p>Nessuna commessa.</p>';

  const rows = jobs
    .map((j) => {
      const customer = customers.find((c) => Number(c.id) === Number(j.customerId || 0));
      const customerName = customer ? (customer.company || `${customer.firstName} ${customer.lastName}`) : 'N/A';
      const customerCell = customer ? `<a href="/gestionale/clienti/${customer.id}">${esc(customerName)}</a>` : esc(customerName);
      const actions = includeActions
        ? `<div class="inline-actions">
            <form method="post" action="/gestionale/lavori/${j.id}/status" class="inline-actions js-auto-submit">
              <select name="status">${JOB_STATUS_OPTIONS.map((s) => `<option value="${s}" ${j.status === s ? 'selected' : ''}>${esc(labelJobStatus(s))}</option>`).join('')}</select>
            </form>
            <a class="btn-link" href="/gestionale/lavori/${j.id}">Scheda</a>
            <form method="post" action="/gestionale/lavori/${j.id}/delete" onsubmit="return confirm('Eliminare questo lavoro?');">
              <button type="submit" class="danger-btn ghost icon-btn" title="Elimina lavoro" aria-label="Elimina lavoro">🗑</button>
            </form>
          </div>`
        : '-';
      return `<tr>
        <td>${customerCell}</td>
        <td>${esc(formatDateItShort(j.dueDate || '-'))}</td>
        <td>€ ${Number(j.amount || 0).toFixed(2)}</td>
        <td>${actions}</td>
      </tr>`;
    })
    .join('');

  return `<table class="tbl tbl-compact"><thead><tr><th>Cliente</th><th>Scadenza</th><th>Importo</th><th>Azione</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function sendRenewalReminders() {
  const store = readStore();
  const renewals = upcomingRenewals(store, 7);
  if (!renewals.length) return;

  const canSend = SMTP_HOST && SMTP_USER && SMTP_PASS && SMTP_FROM;
  let transporter = null;
  if (canSend) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  let changed = false;

  for (const sub of renewals) {
    if (sub.lastReminderSent === today) continue;
    const service = store.services.find((s) => s.id === sub.serviceId);
    const subject = '[Easy Digital Agency] Promemoria rinnovo servizio';
    const text = `Ciao ${sub.customerName || ''},\n\nTi ricordiamo che il servizio "${service ? service.name : 'Servizio'}" scade il ${sub.renewalDate}.\nAccedi alla tua area personale per i dettagli.\n\nEasy Digital Agency`;

    if (canSend && transporter) {
      try {
        await transporter.sendMail({ from: SMTP_FROM, to: sub.email, subject, text });
      } catch (e) {
        console.error('Reminder mail error:', e.message);
      }
    } else {
      console.log('[REMINDER DEMO]', sub.email, subject, text);
    }

    sub.lastReminderSent = today;
    changed = true;
  }

  if (changed) writeStore(store);
}

function renderInviteCompletionForm(customer, token, msg) {
  const notice = msg ? `<p style="color:#15803d;font-weight:600">${esc(msg)}</p>` : '';
  return `
    <h1>Completa registrazione</h1>
    <p>Completa i dati mancanti e imposta la password per attivare la tua area personale.</p>
    ${notice}
    <form method="post" action="/areapersonale/invito" class="form-grid two-col">
      <input type="hidden" name="token" value="${esc(token)}" />
      <input type="text" value="${esc(customer.company || '')}" disabled />
      <input type="text" name="company" placeholder="Azienda" value="${esc(customer.company || '')}" />

      <input type="text" value="${esc(`${customer.firstName} ${customer.lastName}`.trim())}" disabled />
      <input type="email" value="${esc(customer.email || '')}" disabled />

      <input type="text" name="phone" placeholder="Telefono" value="${esc(customer.phone || '')}" />
      <input type="text" name="vat" placeholder="Partita IVA" value="${esc(customer.vat || '')}" />

      <input type="text" name="billingAddress" placeholder="Indirizzo di fatturazione" value="${esc(customer.billingAddress || '')}" />
      <input type="text" name="pec" placeholder="PEC" value="${esc(customer.pec || '')}" />

      <input type="text" name="sdi" placeholder="Codice SDI" value="${esc(customer.sdi || '')}" />
      <input type="password" name="password" placeholder="Password" required />

      <button type="submit">Completa registrazione</button>
    </form>
    <p>Dopo il completamento, accedi da <a href="${WP_BASE_URL}/wp-login.php">Login WordPress</a>.</p>
  `;
}

function renderPublicPage(title, body) {
  return `<!doctype html>
  <html lang="it"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(title)}</title>${baseStyles()}</head>
  <body><div class="shell"><main class="card">${body}</main></div></body></html>`;
}

function renderAppLayout(title, body, user, isAdmin) {
  const userLinks = `
    <a href="/areapersonale">Area personale</a>
    <a href="/logout">Logout</a>
  `;
  const topLinks = isAdmin ? '' : userLinks;
  const adminSidebar = isAdmin
    ? `
      <aside class="side-nav" aria-label="Navigazione gestionale">
        <h3>Navigazione</h3>
        <a data-path="/gestionale" href="/gestionale">Dashboard</a>
        <a data-path="/gestionale/lavori" href="/gestionale/lavori">Lavori</a>
        <a data-path="/gestionale/servizi" href="/gestionale/servizi">Servizi</a>
        <a data-path="/gestionale/rinnovi" href="/gestionale/rinnovi">Rinnovi</a>
        <a data-path="/gestionale/importazioni" href="/gestionale/importazioni">Importazioni</a>
        <a data-path="/gestionale/clienti" href="/gestionale/clienti">Clienti</a>
        <a data-path="/gestionale/ticket" href="/gestionale/ticket">Ticket</a>
        <a data-path="/areapersonale" href="/areapersonale">Area personale</a>
        <a data-path="/logout" href="/logout">Logout</a>
      </aside>
    `
    : '';

  return `<!doctype html>
  <html lang="it">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>${esc(title)}</title>
    ${baseStyles()}
  </head>
  <body>
    <div class="shell app-shell">
      <header class="top">
        <div>
          <strong>Easy Digital Agency - Gestionale</strong>
          <div class="muted">Utente: ${esc(user.display_name || user.email)} (${esc((user.roles || []).join(', '))})</div>
        </div>
        <nav class="nav">${topLinks}</nav>
      </header>
      <div class="app-body ${isAdmin ? 'has-sidebar' : ''}">
        ${adminSidebar}
        <main class="app-main">${body}</main>
      </div>
    </div>
    <script>
      (function () {
        const currentPath = window.location.pathname || '';
        document.querySelectorAll('.side-nav a[data-path]').forEach((a) => {
          const path = a.getAttribute('data-path') || '';
          const exact = path === '/gestionale' ? currentPath === '/gestionale' : currentPath.startsWith(path);
          if (exact) a.classList.add('is-active');
        });

        const dashBtns = document.querySelectorAll('.dash-tab-btn[data-tab]');
        const dashPanels = document.querySelectorAll('.dash-tab-panel[data-panel]');
        dashBtns.forEach((btn) => {
          btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-tab');
            dashBtns.forEach((b) => b.classList.remove('is-active'));
            dashPanels.forEach((p) => p.classList.remove('is-active'));
            btn.classList.add('is-active');
            const panel = document.querySelector('.dash-tab-panel[data-panel="' + key + '"]');
            if (panel) panel.classList.add('is-active');
          });
        });

        document.querySelectorAll('.copy-btn[data-copy]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const value = btn.getAttribute('data-copy') || '';
            try {
              await navigator.clipboard.writeText(value);
              const old = btn.textContent;
              btn.textContent = 'Copiato';
              setTimeout(() => { btn.textContent = old; }, 1200);
            } catch (_e) {}
          });
        });

        document.querySelectorAll('form.js-auto-submit select').forEach((select) => {
          select.addEventListener('change', () => {
            const form = select.closest('form');
            if (form) form.submit();
          });
        });
      })();
    </script>
  </body>
  </html>`;
}

function baseStyles() {
  return `
  <style>
    :root { --g:#3dae63; --txt:#0f172a; --muted:#64748b; --line:#dbe5dd; --bg:#f3f6f4; }
    * { box-sizing:border-box; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; color:var(--txt); background:var(--bg); }
    .shell { max-width:none; margin:0; padding:0 12px 20px; }
    .app-body { display:block; }
    .app-body.has-sidebar { display:grid; grid-template-columns:280px minmax(0,1fr); gap:12px; align-items:start; }
    .app-main { min-width:0; }
    .top { display:flex; justify-content:space-between; gap:14px; align-items:flex-start; background:#fff; border:1px solid var(--line); border-radius:0 0 12px 12px; padding:14px; margin-bottom:12px; }
    .muted { color:var(--muted); font-size:.88rem; margin-top:4px; }
    .nav { display:flex; gap:8px; flex-wrap:wrap; }
    .nav a, .btn-link { text-decoration:none; border:1px solid var(--line); background:#fff; color:#111; padding:7px 10px; border-radius:8px; font-size:.9rem; display:inline-block; }
    .nav a:hover, .btn-link:hover { border-color:var(--g); color:var(--g); }
    .side-nav { background:#fff; border:1px solid var(--line); border-left:none; border-radius:0 12px 12px 0; padding:10px; position:sticky; top:0; min-height:calc(100vh - 2px); display:grid; align-content:start; gap:8px; }
    .side-nav h3 { margin:6px 4px 4px; font-size:1rem; }
    .side-nav a { text-decoration:none; border:1px solid var(--line); border-radius:8px; color:#1e293b; padding:8px 10px; font-size:.92rem; }
    .side-nav a:hover { border-color:#3dae63; color:#166534; }
    .side-nav a.is-active { border-color:#2f9f57; background:#e9f8ef; color:#166534; font-weight:600; }
    h1 { margin:4px 0 12px; font-size:1.65rem; }
    h2 { margin:0 0 10px; font-size:1.2rem; }
    .card { background:#fff; border:1px solid var(--line); border-radius:12px; padding:14px; margin-bottom:14px; }
    .kpi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; }
    .kpi { background:#fff; border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
    .kpi-label { color:var(--muted); font-size:.85rem; }
    .kpi-value { font-size:1.45rem; font-weight:700; color:#165f34; }
    .form-grid { display:grid; gap:10px; }
    .filter-grid { display:grid; gap:10px; grid-template-columns: 1.5fr 1fr auto; margin: 10px 0; align-items:end; }
    .two-col { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .row-between { display:flex; justify-content:space-between; align-items:center; gap:12px; }
    input, select, textarea, button { font:inherit; }
    input, select, textarea { width:100%; padding:10px 11px; border:1px solid var(--line); border-radius:8px; background:#fff; }
    button { border:1px solid #2f9f57; background:#3dae63; color:#fff; border-radius:8px; padding:10px 12px; cursor:pointer; font-weight:600; }
    button:hover { background:#2f9f57; }
    .icon-btn { min-width:38px; padding:8px 10px; font-size:1rem; line-height:1; }
    .danger-btn { border:1px solid #dc2626; background:#ef4444; color:#fff; border-radius:8px; padding:8px 10px; cursor:pointer; font-weight:600; }
    .danger-btn:hover { background:#dc2626; }
    .danger-btn.ghost { background:#fff; color:#b91c1c; }
    .danger-btn.ghost:hover { background:#fef2f2; }
    .copy-btn { border:1px solid var(--line); background:#fff; color:#111; border-radius:8px; padding:6px 9px; cursor:pointer; }
    .copy-btn:hover { border-color:var(--g); color:var(--g); }
    .tbl { width:100%; border-collapse:collapse; table-layout:auto; }
    .tbl th, .tbl td { border-bottom:1px solid #ecf1ed; text-align:left; padding:8px; font-size:.93rem; vertical-align:top; }
    .tbl th { color:#334155; background:#f8fbf9; position: sticky; top: 0; }
    .tbl.tbl-compact th, .tbl.tbl-compact td { padding:6px 7px; font-size:.88rem; }
    .tbl .inline-actions input, .tbl .inline-actions select { min-width:120px; width:auto; padding:7px 8px; }
    .tbl .inline-actions button { padding:7px 9px; }
    code { word-break: break-all; font-size: .82rem; background:#f7faf8; padding: 2px 4px; border-radius:4px; }
    details summary { cursor:pointer; }
    .crm-header { display:flex; justify-content:space-between; align-items:flex-start; gap:14px; }
    .crm-title-wrap h1 { margin:6px 0 6px; }
    .crm-back { text-decoration:none; color:#0f172a; font-size:.9rem; }
    .crm-actions { display:flex; gap:8px; flex-wrap:wrap; }
    .crm-pipeline { overflow:auto; }
    .crm-steps { display:flex; gap:12px; min-width:900px; align-items:center; }
    .crm-step { display:flex; align-items:center; gap:8px; color:#64748b; }
    .crm-step-dot { width:24px; height:24px; border-radius:999px; border:1px solid #94a3b8; display:inline-flex; align-items:center; justify-content:center; font-size:.78rem; background:#fff; }
    .crm-step.is-current { color:#0f172a; font-weight:600; }
    .crm-step.is-current .crm-step-dot { border-color:#3dae63; background:#e9f8ef; color:#166534; }
    .crm-layout { display:grid; grid-template-columns: 320px 1fr; gap:14px; align-items:start; }
    .crm-left h2 { margin-top:12px; }
    .crm-tabs { display:flex; gap:6px; flex-wrap:wrap; border-bottom:1px solid var(--line); padding-bottom:8px; margin-bottom:12px; }
    .crm-tab-btn { border:1px solid var(--line); background:#fff; color:#334155; border-radius:8px; padding:8px 10px; cursor:pointer; }
    .crm-tab-btn.is-active { border-color:#3dae63; color:#166534; background:#e9f8ef; }
    .crm-tab-panel { display:none; }
    .crm-tab-panel.is-active { display:block; }
    .crm-timeline { margin:0; padding-left:18px; display:grid; gap:8px; }
    .crm-notes-list { margin-top:12px; display:grid; gap:8px; }
    .crm-note { border:1px solid var(--line); border-radius:8px; padding:10px; background:#f8fbf9; }
    .status-badge { border:1px solid #bbf7d0; color:#166534; background:#e9f8ef; border-radius:999px; padding:3px 8px; font-size:.82rem; }
    .dash-tabs { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:10px; }
    .dash-tab-btn { border:1px solid var(--line); background:#fff; color:#334155; border-radius:8px; padding:8px 10px; cursor:pointer; }
    .dash-tab-btn.is-active { border-color:#3dae63; background:#e9f8ef; color:#166534; font-weight:600; }
    .dash-tab-panel { display:none; }
    .dash-tab-panel.is-active { display:block; }
    .contact-list { list-style:none; padding:0; margin:8px 0 0; display:grid; gap:8px; }
    .contact-item { border:1px solid var(--line); border-radius:8px; padding:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; }
    .inline-actions { display:flex; gap:8px; align-items:center; flex-wrap:nowrap; }
    .affare-grid { display:grid; gap:10px; grid-template-columns: 180px minmax(0, 1fr); align-items:center; }
    .inline-create { margin-top:8px; border:1px solid #bbf7d0; border-radius:8px; padding:8px 10px; background:#f0fdf4; }
    .inline-create summary { cursor:pointer; color:#166534; font-weight:600; }
    .notice { border:1px solid #cbd5e1; border-radius:8px; background:#f8fafc; color:#0f172a; padding:10px 12px; margin-bottom:10px; }
    .notice.success { border-color:#86efac; background:#f0fdf4; color:#166534; }
    @media (max-width:900px){ .top {flex-direction:column;} .two-col { grid-template-columns:1fr; } .filter-grid { grid-template-columns:1fr; } .row-between { flex-direction:column; align-items:flex-start; } .crm-layout { grid-template-columns:1fr; } .crm-steps { min-width:unset; flex-direction:column; align-items:flex-start; } .app-body.has-sidebar { grid-template-columns:1fr; } .side-nav { position:static; min-height:auto; border-left:1px solid var(--line); border-radius:12px; } .affare-grid { grid-template-columns:1fr; } }
  </style>`;
}
