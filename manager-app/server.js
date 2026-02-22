const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
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

const JOB_STATUS_OPTIONS = ['aperta', 'call_fissata', 'preventivo_inviato', 'attiva', 'chiusa_acquisita', 'chiusa_persa'];

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
  const renewals = chronologicalRenewals(store);
  const jobs = [...store.jobs].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const body = `
    <h1>Gestionale - Dashboard</h1>
    <div class="kpi-grid">
      ${kpi('Clienti', String(store.customers.length))}
      ${kpi('Servizi catalogo', String(store.services.length))}
      ${kpi('Commesse aperte', String(store.jobs.filter((j) => !j.status.startsWith('chiusa_')).length))}
      ${kpi('Rinnovi totali', String(renewals.length))}
      ${kpi('Ticket aperti', String(store.tickets.filter((t) => t.status !== 'closed').length))}
    </div>

    <section class="card">
      <details>
        <summary><strong>Pipeline lavori/commesse</strong> (${jobs.length})</summary>
        <div style="margin-top:12px">${renderJobsTable(jobs, store.customers, store.services, true)}</div>
      </details>
    </section>

    <section class="card">
      <h2>Rinnovi in ordine cronologico</h2>
      ${renderRenewalsTable(renewals, store.services)}
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

app.get('/gestionale/clienti', (req, res) => {
  const store = readStore();
  const body = `
    <h1>Clienti</h1>
    <section class="card row-between">
      <p>Gestisci anagrafiche, inviti, servizi e storico rinnovi.</p>
      <a class="btn-link" href="/gestionale/clienti/new">+ Aggiungi cliente</a>
    </section>

    <section class="card">
      <h2>Tabella clienti</h2>
      ${renderCustomersTable(store)}
    </section>
  `;
  res.send(renderAppLayout('Gestionale - Clienti', body, req.user, true));
});

app.get('/gestionale/clienti/new', (req, res) => {
  const body = `
    <h1>Nuovo cliente</h1>
    <section class="card">
      <h2>Anagrafica cliente e invito</h2>
      <form method="post" action="/gestionale/clienti/new" class="form-grid two-col">
        <input type="text" name="company" placeholder="Azienda" required />
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
  const company = (req.body.company || '').trim();
  const firstName = (req.body.firstName || '').trim();
  const lastName = (req.body.lastName || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const phone = (req.body.phone || '').trim();

  if (!company || !firstName || !lastName || !email || !phone) {
    return res.redirect('/gestionale/clienti/new');
  }

  const store = readStore();
  const existing = store.customers.find((c) => String(c.email || '').toLowerCase() === email);
  if (existing) {
    return res.redirect(`/gestionale/clienti/${existing.id}`);
  }

  const customerId = nextId(store.customers);
  const customer = {
    id: customerId,
    company,
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
  return res.redirect(`/gestionale/clienti/${customerId}`);
});

app.get('/gestionale/clienti/:id', (req, res) => {
  const store = readStore();
  const id = Number(req.params.id || 0);
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

  const body = `
    <h1>Cliente: ${esc(customer.company || `${customer.firstName} ${customer.lastName}`)}</h1>

    <section class="card">
      <h2>Dati cliente</h2>
      <div class="two-col" style="display:grid;gap:10px;grid-template-columns:repeat(2,minmax(0,1fr));">
        <p><strong>Azienda:</strong> ${esc(customer.company || '-')}</p>
        <p><strong>Referente:</strong> ${esc(`${customer.firstName} ${customer.lastName}`.trim())}</p>
        <p><strong>Email:</strong> ${esc(customer.email)}</p>
        <p><strong>Telefono:</strong> ${esc(customer.phone || '-')}</p>
        <p><strong>P.IVA:</strong> ${esc(customer.vat || '-')}</p>
        <p><strong>Stato:</strong> ${esc(customer.status)}</p>
        <p><strong>PEC:</strong> ${esc(customer.pec || '-')}</p>
        <p><strong>SDI:</strong> ${esc(customer.sdi || '-')}</p>
      </div>
      ${inviteLink ? `<p><strong>Link invito attivo:</strong> <a href="${esc(inviteLink)}" target="_blank" rel="noopener">apri</a><br/><code>${esc(inviteLink)}</code></p>` : '<p>Nessun invito pendente.</p>'}
    </section>

    <section class="card">
      <h2>Associa servizio</h2>
      <form method="post" action="/gestionale/clienti/${id}/assign" class="form-grid two-col">
        <select name="serviceId">
          <option value="">Crea nuovo servizio al volo</option>
          ${serviceOptions}
        </select>
        <input name="newServiceName" type="text" placeholder="Nuovo servizio: nome" />

        <input name="newServicePrice" type="number" step="0.01" min="0" placeholder="Nuovo servizio: prezzo" />
        <select name="newServiceBillingType">
          <option value="one_time">Nuovo servizio: una tantum</option>
          <option value="subscription">Nuovo servizio: abbonamento</option>
        </select>

        <select name="newServiceBillingInterval">
          <option value="monthly">Nuovo servizio: mensile</option>
          <option value="semiannual">Nuovo servizio: semestrale</option>
          <option value="annual">Nuovo servizio: annuale</option>
        </select>
        <input type="date" name="purchaseDate" required />

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

    <section class="card">
      <h2>Servizi associati</h2>
      ${renderSubscriptionsTableForAdmin(customerSubs, store.services)}
    </section>

    <section class="card">
      <h2>Prossimi rinnovi</h2>
      ${renderRenewalsTable(upcoming, store.services)}
    </section>

    <section class="card">
      <h2>Storico rinnovi/pagamenti</h2>
      ${renderRenewalsTable(history, store.services)}
    </section>

    <section class="card">
      <h2>Ticket cliente</h2>
      ${renderAdminTickets(customerTickets, [customer])}
    </section>

    <section class="card">
      <h2>Lavori/commesse cliente</h2>
      ${renderJobsTable(customerJobs, store.customers, store.services, true)}
    </section>
  `;

  res.send(renderAppLayout('Gestionale - Dettaglio Cliente', body, req.user, true));
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
    priceAtSale: Number(service.price || 0),
    status: req.body.status || 'active',
    notes: (req.body.notes || '').trim(),
    lastReminderSent: ''
  });

  writeStore(store);
  res.redirect(`/gestionale/clienti/${customerId}`);
});

app.get('/gestionale/lavori', (req, res) => {
  const store = readStore();
  const body = `
    <h1>Lavori / Commesse</h1>
    <section class="card row-between">
      <p>Pipeline commerciale e operativa delle richieste clienti.</p>
      <a class="btn-link" href="/gestionale/lavori/new">+ Nuova commessa</a>
    </section>

    <section class="card">
      ${renderJobsTable(store.jobs, store.customers, store.services, true)}
    </section>
  `;
  res.send(renderAppLayout('Gestionale - Lavori', body, req.user, true));
});

app.get('/gestionale/lavori/new', (req, res) => {
  const store = readStore();
  const customerOptions = store.customers.map((c) => `<option value="${c.id}">${esc(c.company || `${c.firstName} ${c.lastName}`)} - ${esc(c.email)}</option>`).join('');
  const serviceOptions = store.services.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const body = `
    <h1>Nuova commessa</h1>
    <section class="card">
      <form method="post" action="/gestionale/lavori/new" class="form-grid two-col">
        <input type="text" name="title" placeholder="Titolo lavoro/commessa" required />
        <select name="status" required>${JOB_STATUS_OPTIONS.map((s) => `<option value="${s}">${esc(labelJobStatus(s))}</option>`).join('')}</select>

        <select name="customerId"><option value="">Seleziona cliente esistente</option>${customerOptions}</select>
        <input type="text" name="newCustomerCompany" placeholder="Oppure nuova azienda" />

        <input type="text" name="newCustomerFirstName" placeholder="Nuovo cliente: nome referente" />
        <input type="text" name="newCustomerLastName" placeholder="Nuovo cliente: cognome referente" />

        <input type="email" name="newCustomerEmail" placeholder="Nuovo cliente: email" />
        <input type="text" name="newCustomerPhone" placeholder="Nuovo cliente: telefono" />

        <select name="serviceId"><option value="">Servizio collegato (opzionale)</option>${serviceOptions}</select>
        <input type="date" name="dueDate" />

        <input type="number" name="amount" step="0.01" min="0" placeholder="Importo previsto" />
        <textarea name="notes" rows="3" placeholder="Note richiesta cliente"></textarea>

        <button type="submit">Crea commessa</button>
      </form>
    </section>
  `;
  res.send(renderAppLayout('Gestionale - Nuova Commessa', body, req.user, true));
});

app.post('/gestionale/lavori/new', (req, res) => {
  const store = readStore();
  let customerId = Number(req.body.customerId || 0);

  if (!customerId) {
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
  if (!title || !customerId) {
    return res.redirect('/gestionale/lavori/new');
  }

  store.jobs.unshift({
    id: nextId(store.jobs),
    title,
    customerId,
    serviceId: Number(req.body.serviceId || 0) || null,
    notes: (req.body.notes || '').trim(),
    dueDate: (req.body.dueDate || '').trim(),
    amount: Number(req.body.amount || 0),
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  writeStore(store);
  res.redirect('/gestionale/lavori');
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
  res.redirect('/gestionale/lavori');
});

app.get('/gestionale/rinnovi', (req, res) => {
  const store = readStore();
  const renewals = chronologicalRenewals(store);
  const body = `
    <h1>Rinnovi</h1>
    <section class="card">
      <h2>Rinnovi in ordine cronologico</h2>
      ${renderRenewalsTable(renewals, store.services)}
    </section>
  `;
  res.send(renderAppLayout('Gestionale - Rinnovi', body, req.user, true));
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
    if (typeof sub.priceAtSale === 'undefined') sub.priceAtSale = 0;
  }

  for (const job of s.jobs) {
    if (!job.status) job.status = 'aperta';
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
    aperta: 'Aperta',
    call_fissata: 'Call fissata',
    preventivo_inviato: 'Preventivo inviato',
    attiva: 'Attiva',
    chiusa_acquisita: 'Chiusa e acquisita',
    chiusa_persa: 'Chiusa e persa'
  };
  return map[v] || v;
}

function normalizeJobStatus(v) {
  const value = String(v || 'aperta');
  return JOB_STATUS_OPTIONS.includes(value) ? value : 'aperta';
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

function renderCustomersTable(store) {
  if (!store.customers.length) return '<p>Nessun cliente.</p>';

  const rows = store.customers.map((c) => {
    const invite = store.invites.find((i) => i.customerId === c.id && i.status === 'pending');
    const inviteLink = invite ? `${WP_BASE_URL}/areapersonale/invito?token=${invite.token}` : '';
    return `<tr>
      <td><a href="/gestionale/clienti/${c.id}">${esc(c.company || '-')}</a></td>
      <td>${esc(`${c.firstName} ${c.lastName}`.trim())}</td>
      <td>${esc(c.email)}</td>
      <td>${esc(c.phone || '-')}</td>
      <td>${esc(c.vat || '-')}</td>
      <td>${esc(c.status)}</td>
      <td>${inviteLink ? `<code>${esc(inviteLink)}</code>` : '-'}</td>
    </tr>`;
  }).join('');

  return `<table class="tbl"><thead><tr><th>Azienda</th><th>Referente</th><th>Email</th><th>Telefono</th><th>P.IVA</th><th>Stato</th><th>Link invito</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderSubscriptionsTableForAdmin(subs, services) {
  if (!subs.length) return '<p>Nessun servizio associato.</p>';
  const rows = subs.map((s) => {
    const srv = services.find((x) => x.id === s.serviceId);
    return `<tr>
      <td>${esc(srv ? srv.name : 'N/A')}</td>
      <td>${esc(labelBilling(s.billingType, s.billingInterval))}</td>
      <td>${esc(s.purchaseDate || '-')}</td>
      <td>${esc(s.renewalDate || '-')}</td>
      <td>€ ${Number(s.priceAtSale || 0).toFixed(2)}</td>
      <td>${esc(s.status || '-')}</td>
    </tr>`;
  }).join('');

  return `<table class="tbl"><thead><tr><th>Servizio</th><th>Tipo</th><th>Attivazione</th><th>Rinnovo</th><th>Importo</th><th>Stato</th></tr></thead><tbody>${rows}</tbody></table>`;
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

function renderRenewalsTable(rows, services) {
  if (!rows.length) return '<p>Nessun rinnovo.</p>';
  const htmlRows = rows.map((r) => {
    const srv = services.find((s) => s.id === r.serviceId);
    return `<tr><td>${esc(r.renewalDate || '-')}</td><td>${esc(r.company || r.customerName)}</td><td>${esc(r.email)}</td><td>${esc(srv ? srv.name : 'N/A')}</td><td>${esc(labelBilling(r.billingType, r.billingInterval))}</td><td>${esc(r.status)}</td></tr>`;
  }).join('');
  return `<table class="tbl"><thead><tr><th>Rinnovo</th><th>Cliente</th><th>Email</th><th>Servizio</th><th>Tipo</th><th>Stato</th></tr></thead><tbody>${htmlRows}</tbody></table>`;
}

function renderJobsTable(jobs, customers, services, includeActions) {
  if (!jobs.length) return '<p>Nessuna commessa.</p>';

  const rows = jobs
    .map((j) => {
      const customer = customers.find((c) => Number(c.id) === Number(j.customerId || 0));
      const service = services.find((s) => Number(s.id) === Number(j.serviceId || 0));
      const actions = includeActions
        ? `<form method="post" action="/gestionale/lavori/${j.id}/status" style="display:flex;gap:8px;align-items:center"><select name="status">${JOB_STATUS_OPTIONS.map((s) => `<option value="${s}" ${j.status === s ? 'selected' : ''}>${esc(labelJobStatus(s))}</option>`).join('')}</select><button type="submit">Aggiorna</button></form>`
        : '-';
      return `<tr>
        <td>${esc(j.title)}</td>
        <td>${esc(customer ? (customer.company || `${customer.firstName} ${customer.lastName}`) : 'N/A')}</td>
        <td>${esc(service ? service.name : '-')}</td>
        <td>${esc(j.dueDate || '-')}</td>
        <td>€ ${Number(j.amount || 0).toFixed(2)}</td>
        <td>${esc(labelJobStatus(j.status))}</td>
        <td>${esc(j.notes || '-')}</td>
        <td>${actions}</td>
      </tr>`;
    })
    .join('');

  return `<table class="tbl"><thead><tr><th>Commessa</th><th>Cliente</th><th>Servizio</th><th>Scadenza</th><th>Importo</th><th>Stato</th><th>Note</th><th>Azione</th></tr></thead><tbody>${rows}</tbody></table>`;
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
  const adminLinks = isAdmin
    ? `
      <a href="/gestionale">Dashboard</a>
      <a href="/gestionale/clienti">Clienti</a>
      <a href="/gestionale/lavori">Lavori</a>
      <a href="/gestionale/servizi">Servizi</a>
      <a href="/gestionale/rinnovi">Rinnovi</a>
      <a href="/gestionale/ticket">Ticket</a>
    `
    : '';

  const userLinks = `
    <a href="/areapersonale">Area personale</a>
    <a href="/logout">Logout</a>
  `;

  return `<!doctype html>
  <html lang="it">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>${esc(title)}</title>
    ${baseStyles()}
  </head>
  <body>
    <div class="shell">
      <header class="top">
        <div>
          <strong>Easy Digital Agency - Gestionale</strong>
          <div class="muted">Utente: ${esc(user.display_name || user.email)} (${esc((user.roles || []).join(', '))})</div>
        </div>
        <nav class="nav">${adminLinks}${userLinks}</nav>
      </header>
      <main>${body}</main>
    </div>
  </body>
  </html>`;
}

function baseStyles() {
  return `
  <style>
    :root { --g:#3dae63; --txt:#0f172a; --muted:#64748b; --line:#dbe5dd; --bg:#f3f6f4; }
    * { box-sizing:border-box; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; color:var(--txt); background:var(--bg); }
    .shell { max-width:1280px; margin:0 auto; padding:22px 16px 40px; }
    .top { display:flex; justify-content:space-between; gap:14px; align-items:flex-start; background:#fff; border:1px solid var(--line); border-radius:12px; padding:14px; margin-bottom:16px; }
    .muted { color:var(--muted); font-size:.88rem; margin-top:4px; }
    .nav { display:flex; gap:8px; flex-wrap:wrap; }
    .nav a, .btn-link { text-decoration:none; border:1px solid var(--line); background:#fff; color:#111; padding:7px 10px; border-radius:8px; font-size:.9rem; display:inline-block; }
    .nav a:hover, .btn-link:hover { border-color:var(--g); color:var(--g); }
    h1 { margin:4px 0 12px; font-size:1.65rem; }
    h2 { margin:0 0 10px; font-size:1.2rem; }
    .card { background:#fff; border:1px solid var(--line); border-radius:12px; padding:14px; margin-bottom:14px; }
    .kpi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; }
    .kpi { background:#fff; border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
    .kpi-label { color:var(--muted); font-size:.85rem; }
    .kpi-value { font-size:1.45rem; font-weight:700; color:#165f34; }
    .form-grid { display:grid; gap:10px; }
    .two-col { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .row-between { display:flex; justify-content:space-between; align-items:center; gap:12px; }
    input, select, textarea, button { font:inherit; }
    input, select, textarea { width:100%; padding:10px 11px; border:1px solid var(--line); border-radius:8px; background:#fff; }
    button { border:1px solid #2f9f57; background:#3dae63; color:#fff; border-radius:8px; padding:10px 12px; cursor:pointer; font-weight:600; }
    button:hover { background:#2f9f57; }
    .tbl { width:100%; border-collapse:collapse; }
    .tbl th, .tbl td { border-bottom:1px solid #ecf1ed; text-align:left; padding:8px; font-size:.93rem; vertical-align:top; }
    .tbl th { color:#334155; background:#f8fbf9; position: sticky; top: 0; }
    code { word-break: break-all; font-size: .82rem; background:#f7faf8; padding: 2px 4px; border-radius:4px; }
    details summary { cursor:pointer; }
    @media (max-width:900px){ .top {flex-direction:column;} .two-col { grid-template-columns:1fr; } .row-between { flex-direction:column; align-items:flex-start; } }
  </style>`;
}
