const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const nodemailer = require('nodemailer');

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

ensureStore();

app.get('/health', (_, res) => res.json({ ok: true, app: 'eda-manager' }));

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
  } catch (e) {
    return res.status(401).send('Token non valido');
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.redirect('/areapersonale');
});

app.get('/areapersonale/registrazione', (req, res) => {
  res.send(renderPublicPage('Registrazione', renderRegistrationForm(req.query.msg || '')));
});

app.post('/areapersonale/registrazione', async (req, res) => {
  const username = (req.body.username || '').trim();
  const email = (req.body.email || '').trim();
  const displayName = (req.body.display_name || '').trim();
  const password = (req.body.password || '').trim();

  if (!WP_BASE_URL) {
    return res.status(500).send('WP_BASE_URL non configurato');
  }

  try {
    const resp = await fetch(`${WP_BASE_URL}/wp-json/eda-auth/v1/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, display_name: displayName, password })
    });

    const data = await resp.json();
    if (!resp.ok) {
      return res.send(renderPublicPage('Registrazione', renderRegistrationForm(data.message || 'Errore registrazione')));
    }

    return res.redirect('/areapersonale/registrazione?msg=' + encodeURIComponent('Registrazione completata. Ora effettua il login WordPress.'));
  } catch (err) {
    return res.send(renderPublicPage('Registrazione', renderRegistrationForm('Errore di connessione a WordPress.')));
  }
});

app.use(['/gestionale', '/areapersonale'], authMiddleware);

app.get('/areapersonale', (req, res) => {
  const store = readStore();
  const userId = req.user.sub;
  const email = req.user.email;

  const mySubs = store.subscriptions.filter((s) => Number(s.wpUserId) === Number(userId));
  const myTickets = store.tickets.filter((t) => Number(t.wpUserId) === Number(userId));

  const enrichedSubs = mySubs.map((s) => {
    const srv = store.services.find((x) => x.id === s.serviceId);
    return { ...s, serviceName: srv ? srv.name : `Servizio #${s.serviceId}`, billingType: srv ? srv.billingType : 'one_time', price: srv ? srv.price : 0 };
  });

  const body = `
    <h1>Area Personale</h1>
    <p>Ciao <strong>${esc(req.user.display_name || req.user.email)}</strong>. Qui trovi i tuoi servizi, i rinnovi e i ticket.</p>

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
  store.tickets.unshift({
    id: nextId(store.tickets),
    wpUserId: Number(req.user.sub),
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
  const renew90 = upcomingRenewals(store, 90);

  const body = `
    <h1>Gestionale - Dashboard</h1>
    <div class="kpi-grid">
      ${kpi('Servizi catalogo', String(store.services.length))}
      ${kpi('Abbonamenti/assegnazioni', String(store.subscriptions.length))}
      ${kpi('Rinnovi entro 90gg', String(renew90.length))}
      ${kpi('Ticket aperti', String(store.tickets.filter(t => t.status !== 'closed').length))}
    </div>
  `;
  res.send(renderAppLayout('Gestionale', body, req.user, true));
});

app.get('/gestionale/servizi', (req, res) => {
  const store = readStore();
  const body = `
    <h1>Gestione Servizi</h1>
    <section class="card">
      <h2>Nuovo servizio</h2>
      <form method="post" action="/gestionale/servizi/new" class="form-grid">
        <input name="name" type="text" placeholder="Nome servizio" required />
        <textarea name="description" rows="3" placeholder="Descrizione"></textarea>
        <input name="price" type="number" step="0.01" min="0" placeholder="Prezzo" required />
        <select name="billingType"><option value="one_time">Una tantum</option><option value="annual">Rinnovo annuale</option></select>
        <button type="submit">Salva servizio</button>
      </form>
    </section>
    <section class="card">
      <h2>Catalogo servizi</h2>
      ${renderServicesTable(store.services)}
    </section>
  `;
  res.send(renderAppLayout('Gestionale - Servizi', body, req.user, true));
});

app.post('/gestionale/servizi/new', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.redirect('/gestionale/servizi');
  const store = readStore();
  store.services.unshift({
    id: nextId(store.services),
    name,
    description: (req.body.description || '').trim(),
    price: Number(req.body.price || 0),
    billingType: req.body.billingType === 'annual' ? 'annual' : 'one_time',
    active: true,
    createdAt: new Date().toISOString()
  });
  writeStore(store);
  res.redirect('/gestionale/servizi');
});

app.get('/gestionale/clienti', (req, res) => {
  const store = readStore();
  const serviceOptions = store.services.map((s) => `<option value="${s.id}">${esc(s.name)} (${s.billingType === 'annual' ? 'annuale' : 'una tantum'})</option>`).join('');

  const body = `
    <h1>Clienti e assegnazioni</h1>
    <section class="card">
      <h2>Assegna servizio cliente</h2>
      <form method="post" action="/gestionale/clienti/assign" class="form-grid">
        <input type="number" name="wpUserId" min="1" placeholder="ID utente WordPress" required />
        <input type="text" name="customerName" placeholder="Nome cliente" required />
        <input type="email" name="email" placeholder="Email cliente" required />
        <select name="serviceId" required><option value="">Seleziona servizio</option>${serviceOptions}</select>
        <input type="date" name="purchaseDate" required />
        <input type="date" name="renewalDate" />
        <select name="status"><option value="active">Attivo</option><option value="expired">Scaduto</option><option value="cancelled">Annullato</option></select>
        <textarea name="notes" rows="2" placeholder="Note"></textarea>
        <button type="submit">Assegna</button>
      </form>
    </section>
    <section class="card">
      <h2>Lista clienti/servizi</h2>
      ${renderAdminSubscriptions(store)}
    </section>
  `;
  res.send(renderAppLayout('Gestionale - Clienti', body, req.user, true));
});

app.post('/gestionale/clienti/assign', (req, res) => {
  const store = readStore();
  const wpUserId = Number(req.body.wpUserId || 0);
  const serviceId = Number(req.body.serviceId || 0);
  if (!wpUserId || !serviceId) return res.redirect('/gestionale/clienti');
  store.subscriptions.unshift({
    id: nextId(store.subscriptions),
    wpUserId,
    customerName: (req.body.customerName || '').trim(),
    email: (req.body.email || '').trim(),
    serviceId,
    purchaseDate: req.body.purchaseDate || '',
    renewalDate: req.body.renewalDate || '',
    status: req.body.status || 'active',
    notes: (req.body.notes || '').trim(),
    lastReminderSent: ''
  });
  writeStore(store);
  res.redirect('/gestionale/clienti');
});

app.get('/gestionale/rinnovi', (req, res) => {
  const store = readStore();
  const renewals = upcomingRenewals(store, 90);
  const body = `
    <h1>Rinnovi in scadenza</h1>
    <section class="card">
      <h2>Prossimi 90 giorni</h2>
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
      ${renderAdminTickets(store.tickets)}
    </section>
  `;
  res.send(renderAppLayout('Gestionale - Ticket', body, req.user, true));
});

app.post('/gestionale/ticket/:id/status', (req, res) => {
  const id = Number(req.params.id || 0);
  const status = ['open', 'in_progress', 'closed'].includes(req.body.status) ? req.body.status : 'open';
  const store = readStore();
  const ticket = store.tickets.find((t) => t.id === id);
  if (ticket) ticket.status = status;
  writeStore(store);
  res.redirect('/gestionale/ticket');
});

cron.schedule('0 9 * * *', async () => {
  await sendRenewalReminders();
});

app.get('/', (req, res) => res.redirect('/areapersonale'));

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
  } catch (e) {
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
    fs.writeFileSync(STORE_FILE, JSON.stringify({ services: [], subscriptions: [], tickets: [] }, null, 2), 'utf8');
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
}

function writeStore(data) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function nextId(arr) {
  return arr.length ? Math.max(...arr.map((x) => Number(x.id) || 0)) + 1 : 1;
}

function upcomingRenewals(store, days) {
  const now = new Date();
  const max = new Date(now.getTime() + days * 86400000);
  return store.subscriptions.filter((s) => {
    if (!s.renewalDate || s.status !== 'active') return false;
    const d = new Date(s.renewalDate + 'T00:00:00');
    return d >= new Date(now.toDateString()) && d <= max;
  }).sort((a, b) => String(a.renewalDate).localeCompare(String(b.renewalDate)));
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

function renderServicesTable(services) {
  if (!services.length) return '<p>Nessun servizio in catalogo.</p>';
  const rows = services.map((s) => `<tr><td>${s.id}</td><td>${esc(s.name)}</td><td>€ ${Number(s.price || 0).toFixed(2)}</td><td>${s.billingType === 'annual' ? 'Annuale' : 'Una tantum'}</td></tr>`).join('');
  return `<table class="tbl"><thead><tr><th>ID</th><th>Servizio</th><th>Prezzo</th><th>Tipo</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderAdminSubscriptions(store) {
  if (!store.subscriptions.length) return '<p>Nessuna assegnazione.</p>';
  const rows = store.subscriptions.map((s) => {
    const srv = store.services.find((x) => x.id === s.serviceId);
    return `<tr><td>${esc(s.customerName)}</td><td>${esc(s.email)}</td><td>${esc(srv ? srv.name : 'N/A')}</td><td>${esc(s.purchaseDate)}</td><td>${esc(s.renewalDate || '-')}</td><td>${esc(s.status)}</td></tr>`;
  }).join('');
  return `<table class="tbl"><thead><tr><th>Cliente</th><th>Email</th><th>Servizio</th><th>Acquisto</th><th>Rinnovo</th><th>Stato</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderSubscriptionsTable(subs) {
  if (!subs.length) return '<p>Non risultano servizi associati al tuo account.</p>';
  const rows = subs.map((s) => `<tr><td>${esc(s.serviceName)}</td><td>${s.billingType === 'annual' ? 'Annuale' : 'Una tantum'}</td><td>€ ${Number(s.price || 0).toFixed(2)}</td><td>${esc(s.purchaseDate)}</td><td>${esc(s.renewalDate || '-')}</td><td>${esc(s.status)}</td></tr>`).join('');
  return `<table class="tbl"><thead><tr><th>Servizio</th><th>Tipo</th><th>Prezzo</th><th>Acquisto</th><th>Rinnovo</th><th>Stato</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderTicketsTable(tickets) {
  if (!tickets.length) return '<p>Nessun ticket ancora aperto.</p>';
  const rows = tickets.map((t) => `<tr><td>${esc(t.subject)}</td><td>${esc(t.status)}</td><td>${esc((t.createdAt || '').slice(0, 10))}</td></tr>`).join('');
  return `<table class="tbl"><thead><tr><th>Oggetto</th><th>Stato</th><th>Data</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderAdminTickets(tickets) {
  if (!tickets.length) return '<p>Nessun ticket.</p>';
  const rows = tickets.map((t) => `
    <tr>
      <td>${t.id}</td><td>${esc(t.email)}</td><td>${esc(t.subject)}</td><td>${esc(t.status)}</td>
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
  `).join('');
  return `<table class="tbl"><thead><tr><th>ID</th><th>Email</th><th>Oggetto</th><th>Stato</th><th>Azione</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderRenewalsTable(rows, services) {
  if (!rows.length) return '<p>Nessun rinnovo nei prossimi 90 giorni.</p>';
  const htmlRows = rows.map((r) => {
    const srv = services.find((s) => s.id === r.serviceId);
    return `<tr><td>${esc(r.renewalDate)}</td><td>${esc(r.customerName)}</td><td>${esc(r.email)}</td><td>${esc(srv ? srv.name : 'N/A')}</td><td>${esc(r.status)}</td></tr>`;
  }).join('');
  return `<table class="tbl"><thead><tr><th>Rinnovo</th><th>Cliente</th><th>Email</th><th>Servizio</th><th>Stato</th></tr></thead><tbody>${htmlRows}</tbody></table>`;
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

function renderRegistrationForm(msg) {
  const notice = msg ? `<p style="color:#15803d;font-weight:600">${esc(msg)}</p>` : '';
  return `
    <h1>Registrazione Area Personale</h1>
    <p>Registrati per accedere alla tua area personale e visualizzare servizi, rinnovi e ticket.</p>
    ${notice}
    <form method="post" action="/areapersonale/registrazione" class="form-grid">
      <input type="text" name="username" placeholder="Username" required />
      <input type="email" name="email" placeholder="Email" required />
      <input type="text" name="display_name" placeholder="Nome e Cognome" required />
      <input type="password" name="password" placeholder="Password" required />
      <button type="submit">Crea account</button>
    </form>
    <p>Hai gia un account? <a href="${WP_BASE_URL}/wp-login.php">Accedi con WordPress</a></p>
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
      <a href="/gestionale/servizi">Servizi</a>
      <a href="/gestionale/clienti">Clienti</a>
      <a href="/gestionale/rinnovi">Rinnovi</a>
      <a href="/gestionale/ticket">Ticket</a>
    `
    : '';

  const userLinks = `
    <a href="/areapersonale">Area personale</a>
    ${isAdmin ? '<a href="/areapersonale/registrazione">Nuova registrazione</a>' : ''}
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
    .shell { max-width:1180px; margin:0 auto; padding:22px 16px 40px; }
    .top { display:flex; justify-content:space-between; gap:14px; align-items:flex-start; background:#fff; border:1px solid var(--line); border-radius:12px; padding:14px; margin-bottom:16px; }
    .muted { color:var(--muted); font-size:.88rem; margin-top:4px; }
    .nav { display:flex; gap:8px; flex-wrap:wrap; }
    .nav a { text-decoration:none; border:1px solid var(--line); background:#fff; color:#111; padding:7px 10px; border-radius:8px; font-size:.9rem; }
    .nav a:hover { border-color:var(--g); color:var(--g); }
    h1 { margin:4px 0 12px; font-size:1.65rem; }
    h2 { margin:0 0 10px; font-size:1.2rem; }
    .card { background:#fff; border:1px solid var(--line); border-radius:12px; padding:14px; margin-bottom:14px; }
    .kpi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; }
    .kpi { background:#fff; border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
    .kpi-label { color:var(--muted); font-size:.85rem; }
    .kpi-value { font-size:1.45rem; font-weight:700; color:#165f34; }
    .form-grid { display:grid; gap:10px; }
    input, select, textarea, button { font:inherit; }
    input, select, textarea { width:100%; padding:10px 11px; border:1px solid var(--line); border-radius:8px; background:#fff; }
    button { border:1px solid #2f9f57; background:#3dae63; color:#fff; border-radius:8px; padding:10px 12px; cursor:pointer; font-weight:600; }
    button:hover { background:#2f9f57; }
    .tbl { width:100%; border-collapse:collapse; }
    .tbl th, .tbl td { border-bottom:1px solid #ecf1ed; text-align:left; padding:8px; font-size:.93rem; vertical-align:top; }
    .tbl th { color:#334155; background:#f8fbf9; }
    @media (max-width:900px){ .top {flex-direction:column;} }
  </style>`;
}
