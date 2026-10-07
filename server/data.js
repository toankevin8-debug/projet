// Requêtes de l'application. Toutes filtrent par user_id : un compte ne voit que ses données.
import { many, one, query, tx } from './db.js';

// --- Profil ---------------------------------------------------------------------

export const PROFILE_FIELDS = [
  'business_name', 'legal_form', 'ncc', 'rccm', 'capital', 'tax_regime', 'tax_center', 'address', 'city',
  'phone', 'email_pro', 'vat_applicable', 'vat_rate', 'payment_info', 'late_penalty_text', 'signature_text',
  'invoice_prefix', 'credit_note_prefix', 'quote_prefix', 'default_terms_days', 'fne_registered',
];

export async function saveProfile(userId, p) {
  const values = PROFILE_FIELDS.map((f) => p[f]);
  const cols = PROFILE_FIELDS.join(', ');
  const params = PROFILE_FIELDS.map((_, i) => `$${i + 2}`).join(', ');
  const updates = PROFILE_FIELDS.map((f) => `${f} = EXCLUDED.${f}`).join(', ');
  await query(
    `INSERT INTO business_profiles (user_id, ${cols}) VALUES ($1, ${params})
     ON CONFLICT (user_id) DO UPDATE SET ${updates}, updated_at = now()`,
    [userId, ...values],
  );
}

// --- Clients -------------------------------------------------------------------

export function listClients(userId) {
  return many(
    `SELECT c.*,
            count(i.id) FILTER (WHERE i.kind = 'facture' AND i.status <> 'brouillon') AS invoices,
            coalesce(sum(o.remaining), 0)::bigint AS remaining,
            s.avg_delay_days
     FROM clients c
     LEFT JOIN invoices i ON i.client_id = c.id
     LEFT JOIN invoice_overview o ON o.id = i.id
     LEFT JOIN client_payment_scores s ON s.client_id = c.id
     WHERE c.user_id = $1
     GROUP BY c.id, s.avg_delay_days
     ORDER BY lower(c.name)`,
    [userId],
  );
}

export const getClient = (userId, id) =>
  one('SELECT * FROM clients WHERE id = $1 AND user_id = $2', [id, userId]);

const CLIENT_FIELDS = ['type', 'name', 'ncc', 'phone', 'email', 'address', 'notes'];

export async function saveClient(userId, id, c) {
  const values = CLIENT_FIELDS.map((f) => c[f]);
  if (id) {
    const set = CLIENT_FIELDS.map((f, i) => `${f} = $${i + 3}`).join(', ');
    return one(`UPDATE clients SET ${set} WHERE id = $1 AND user_id = $2 RETURNING *`, [id, userId, ...values]);
  }
  return one(
    `INSERT INTO clients (user_id, ${CLIENT_FIELDS.join(', ')})
     VALUES ($1, ${CLIENT_FIELDS.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`,
    [userId, ...values],
  );
}

export const deleteClient = (userId, id) => query('DELETE FROM clients WHERE id = $1 AND user_id = $2', [id, userId]);

// --- Factures --------------------------------------------------------------------

export function listInvoices(userId, filter) {
  const where = {
    brouillons: "o.status = 'brouillon'",
    a_certifier: 'o.to_certify',
    impayees: "o.kind = 'facture' AND o.status IN ('emise', 'partiellement_payee')",
    en_retard: "o.display_status = 'en_retard'",
    payees: "o.status = 'payee'",
    avoirs: "o.kind = 'avoir'",
  }[filter] || 'true';
  return many(
    `SELECT o.*, c.name AS client_name, i.created_at, i.sent_at,
            (SELECT coalesce(sum(round(qty * unit_price)), 0)::bigint FROM invoice_items WHERE invoice_id = o.id) AS draft_ht
     FROM invoice_overview o
     JOIN invoices i ON i.id = o.id
     JOIN clients c ON c.id = o.client_id
     WHERE o.user_id = $1 AND ${where}
     ORDER BY (o.status = 'brouillon') DESC, o.issue_date DESC NULLS LAST, o.number DESC NULLS LAST, i.created_at DESC`,
    [userId],
  );
}

export function invoiceCounts(userId) {
  return one(
    `SELECT count(*) AS tous,
            count(*) FILTER (WHERE status = 'brouillon') AS brouillons,
            count(*) FILTER (WHERE to_certify) AS a_certifier,
            count(*) FILTER (WHERE kind = 'facture' AND status IN ('emise', 'partiellement_payee')) AS impayees,
            count(*) FILTER (WHERE display_status = 'en_retard') AS en_retard,
            count(*) FILTER (WHERE status = 'payee') AS payees,
            count(*) FILTER (WHERE kind = 'avoir') AS avoirs
     FROM invoice_overview WHERE user_id = $1`,
    [userId],
  );
}

export async function getInvoice(userId, id) {
  const inv = await one(
    `SELECT i.*, o.credited, o.paid, o.remaining, o.display_status, o.to_certify, o.amount_in_words,
            r.number AS ref_number,
            to_jsonb(c) AS client,
            CASE WHEN f.id IS NULL THEN NULL ELSE to_jsonb(f) END AS certification
     FROM invoices i
     JOIN invoice_overview o ON o.id = i.id
     JOIN clients c ON c.id = i.client_id
     LEFT JOIN invoices r ON r.id = i.ref_invoice_id
     LEFT JOIN fne_certifications f ON f.invoice_id = i.id
     WHERE i.id = $1 AND i.user_id = $2`,
    [id, userId],
  );
  if (!inv) return null;
  inv.items = await many('SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY position', [id]);
  inv.payments = await many('SELECT * FROM payments WHERE invoice_id = $1 ORDER BY payment_date, created_at', [id]);
  inv.credit_notes = await many(
    `SELECT id, number, status, total_ttc, issue_date FROM invoices
     WHERE ref_invoice_id = $1 ORDER BY created_at`,
    [id],
  );
  inv.reminders = await many('SELECT * FROM reminders WHERE invoice_id = $1 ORDER BY sent_at DESC', [id]);
  inv.compliance = inv.status === 'brouillon' ? await many('SELECT * FROM compliance_check($1)', [id]) : [];
  return inv;
}

// Lecture publique d'une facture certifiée (lien envoyé au client).
export async function getPublicInvoice(id) {
  const inv = await one(
    `SELECT i.*, o.amount_in_words, r.number AS ref_number, to_jsonb(f) AS certification
     FROM invoices i
     JOIN invoice_overview o ON o.id = i.id
     JOIN fne_certifications f ON f.invoice_id = i.id
     LEFT JOIN invoices r ON r.id = i.ref_invoice_id
     WHERE i.id = $1`,
    [id],
  );
  if (!inv) return null;
  inv.items = await many('SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY position', [id]);
  return inv;
}

async function replaceItems(client, table, fk, id, items) {
  await client.query(`DELETE FROM ${table} WHERE ${fk} = $1`, [id]);
  let position = 0;
  for (const it of items) {
    position += 1;
    await client.query(
      `INSERT INTO ${table} (${fk}, position, description, qty, unit_price, vat_applicable)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, position, it.description, it.qty, it.unit_price, it.vat_applicable],
    );
  }
}

// Crée ou met à jour un brouillon de facture (ou d'avoir) avec ses lignes.
export function saveInvoiceDraft(userId, id, d) {
  return tx(async (client) => {
    let invoiceId = id;
    if (id) {
      const { rowCount } = await client.query(
        `UPDATE invoices SET client_id = $3, terms_days = $4, vat_applicable = $5, notes = $6
         WHERE id = $1 AND user_id = $2 AND status = 'brouillon'`,
        [id, userId, d.client_id, d.terms_days, d.vat_applicable, d.notes],
      );
      if (rowCount === 0) throw Object.assign(new Error('Brouillon introuvable ou déjà émis.'), { code: 'P0002' });
    } else {
      const { rows } = await client.query(
        `INSERT INTO invoices (user_id, client_id, terms_days, vat_applicable, notes)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [userId, d.client_id, d.terms_days, d.vat_applicable, d.notes],
      );
      invoiceId = rows[0].id;
    }
    await replaceItems(client, 'invoice_items', 'invoice_id', invoiceId, d.items);
    return invoiceId;
  });
}

async function owned(userId, id) {
  const row = await one('SELECT id FROM invoices WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!row) throw Object.assign(new Error('Facture introuvable.'), { code: 'P0002' });
}

export async function emitInvoice(userId, id) {
  await owned(userId, id);
  return one('SELECT * FROM emit_invoice($1)', [id]);
}

export async function certifyInvoice(userId, id, c) {
  await owned(userId, id);
  return one('SELECT * FROM record_fne_certification($1, $2, $3, $4, $5, $6, $7)', [
    id, c.fiscal_number, c.certified_at, c.qr_reference || null, c.document_url || null, c.mode || 'manuel', c.api_response ?? null,
  ]);
}

export async function markSent(userId, id) {
  await owned(userId, id);
  return one('SELECT * FROM mark_invoice_sent($1)', [id]);
}

export async function createCreditNote(userId, id) {
  await owned(userId, id);
  return (await one('SELECT create_credit_note($1) AS id', [id])).id;
}

export async function duplicateInvoice(userId, id) {
  await owned(userId, id);
  return tx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO invoices (user_id, client_id, terms_days, vat_applicable, notes)
       SELECT user_id, client_id, terms_days, vat_applicable, notes FROM invoices WHERE id = $1 RETURNING id`,
      [id],
    );
    await client.query(
      `INSERT INTO invoice_items (invoice_id, position, description, qty, unit_price, vat_applicable)
       SELECT $2, position, description, qty, unit_price, vat_applicable FROM invoice_items WHERE invoice_id = $1`,
      [id, rows[0].id],
    );
    return rows[0].id;
  });
}

export const deleteDraft = (userId, id) =>
  query("DELETE FROM invoices WHERE id = $1 AND user_id = $2 AND status = 'brouillon'", [id, userId]);

export function addPayment(userId, invoiceId, p) {
  return query(
    `INSERT INTO payments (user_id, invoice_id, amount, payment_date, method, reference)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, invoiceId, p.amount, p.payment_date, p.method, p.reference || null],
  );
}

export function addReminder(userId, invoiceId, r) {
  return query(
    `INSERT INTO reminders (user_id, invoice_id, channel, tone, message, ai_generated)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, invoiceId, r.channel, r.tone, r.message, r.ai_generated ?? false],
  );
}

// --- Devis -------------------------------------------------------------------------

export function listQuotes(userId) {
  return many(
    `SELECT q.*, c.name AS client_name,
            (SELECT coalesce(sum(round(qty * unit_price)), 0)::bigint FROM quote_items WHERE quote_id = q.id) AS total_ht,
            (SELECT id FROM invoices WHERE quote_id = q.id LIMIT 1) AS invoice_id
     FROM quotes q JOIN clients c ON c.id = q.client_id
     WHERE q.user_id = $1 ORDER BY q.created_at DESC`,
    [userId],
  );
}

export async function getQuote(userId, id) {
  const q = await one(
    `SELECT q.*, to_jsonb(c) AS client, (SELECT id FROM invoices WHERE quote_id = q.id LIMIT 1) AS invoice_id
     FROM quotes q JOIN clients c ON c.id = q.client_id WHERE q.id = $1 AND q.user_id = $2`,
    [id, userId],
  );
  if (!q) return null;
  q.items = await many('SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY position', [id]);
  return q;
}

export function saveQuote(userId, id, d) {
  return tx(async (client) => {
    let quoteId = id;
    if (id) {
      const { rowCount } = await client.query(
        `UPDATE quotes SET client_id = $3, valid_until = $4, notes = $5
         WHERE id = $1 AND user_id = $2 AND status IN ('brouillon', 'envoye')`,
        [id, userId, d.client_id, d.valid_until, d.notes],
      );
      if (rowCount === 0) throw Object.assign(new Error('Ce devis ne peut plus être modifié.'), { code: 'P0002' });
    } else {
      const { rows } = await client.query(
        'INSERT INTO quotes (user_id, client_id, valid_until, notes) VALUES ($1, $2, $3, $4) RETURNING id',
        [userId, d.client_id, d.valid_until, d.notes],
      );
      quoteId = rows[0].id;
    }
    await replaceItems(client, 'quote_items', 'quote_id', quoteId, d.items);
    return quoteId;
  });
}

export const setQuoteStatus = (userId, id, status) =>
  query('UPDATE quotes SET status = $3 WHERE id = $1 AND user_id = $2', [id, userId, status]);

export async function convertQuote(userId, id) {
  const q = await one('SELECT id FROM quotes WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!q) throw Object.assign(new Error('Devis introuvable.'), { code: 'P0002' });
  return (await one('SELECT convert_quote_to_invoice($1) AS id', [id])).id;
}

// --- Paiements ------------------------------------------------------------------------

export function listPayments(userId) {
  return many(
    `SELECT p.*, i.number, c.name AS client_name
     FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN clients c ON c.id = i.client_id
     WHERE p.user_id = $1 ORDER BY p.payment_date DESC, p.created_at DESC`,
    [userId],
  );
}

export function openInvoices(userId) {
  return many(
    `SELECT o.*, c.name AS client_name, c.phone AS client_phone
     FROM invoice_overview o JOIN clients c ON c.id = o.client_id
     WHERE o.user_id = $1 AND o.kind = 'facture' AND o.status IN ('emise', 'partiellement_payee')
     ORDER BY o.due_date`,
    [userId],
  );
}

// --- Tableau de bord ---------------------------------------------------------------------

export async function dashboard(userId) {
  const figures = await one(
    `SELECT
       coalesce(sum(total_ttc) FILTER (WHERE kind = 'facture' AND status <> 'brouillon'
                AND issue_date >= date_trunc('month', current_date)), 0)::bigint AS billed_month,
       (SELECT coalesce(sum(amount), 0)::bigint FROM payments
         WHERE user_id = $1 AND payment_date >= date_trunc('month', current_date)) AS cashed_month,
       coalesce(sum(remaining), 0)::bigint AS outstanding,
       count(*) FILTER (WHERE remaining > 0) AS outstanding_count,
       coalesce(sum(remaining) FILTER (WHERE display_status = 'en_retard'), 0)::bigint AS overdue,
       count(*) FILTER (WHERE display_status = 'en_retard') AS overdue_count,
       count(*) FILTER (WHERE to_certify) AS to_certify
     FROM invoice_overview WHERE user_id = $1`,
    [userId],
  );
  const forecast = (await one('SELECT * FROM cash_forecast WHERE user_id = $1', [userId])) || {
    expected_7_days: 0,
    expected_30_days: 0,
  };
  const months = await many(
    `WITH m AS (
       SELECT generate_series(date_trunc('month', current_date) - interval '5 months',
                              date_trunc('month', current_date), interval '1 month')::date AS month)
     SELECT m.month,
            (SELECT coalesce(sum(total_ttc), 0)::bigint FROM invoices
              WHERE user_id = $1 AND kind = 'facture' AND status <> 'brouillon'
                AND date_trunc('month', issue_date) = m.month) AS billed,
            (SELECT coalesce(sum(amount), 0)::bigint FROM payments
              WHERE user_id = $1 AND date_trunc('month', payment_date) = m.month) AS cashed
     FROM m ORDER BY m.month`,
    [userId],
  );
  const todo = await many(
    `SELECT o.id, o.number, o.kind, o.display_status, o.remaining, o.due_date, o.to_certify, o.total_ttc,
            c.name AS client_name
     FROM invoice_overview o JOIN clients c ON c.id = o.client_id
     WHERE o.user_id = $1 AND (o.to_certify OR o.display_status = 'en_retard'
           OR (o.remaining > 0 AND o.due_date BETWEEN current_date AND current_date + 3))
     ORDER BY o.to_certify DESC, o.due_date
     LIMIT 8`,
    [userId],
  );
  const recent = await many(
    `SELECT o.id, o.number, o.status, o.display_status, o.total_ttc, o.issue_date, c.name AS client_name
     FROM invoice_overview o JOIN clients c ON c.id = o.client_id
     WHERE o.user_id = $1 AND o.status <> 'brouillon' ORDER BY o.issue_date DESC, o.number DESC LIMIT 6`,
    [userId],
  );
  const steps = await one(
    `SELECT (SELECT count(*) FROM clients WHERE user_id = $1) AS clients,
            count(*) FILTER (WHERE status <> 'brouillon') AS emitted,
            count(*) FILTER (WHERE status <> 'brouillon' AND NOT to_certify) AS certified
     FROM invoice_overview WHERE user_id = $1`,
    [userId],
  );
  return { figures, forecast, months, todo, recent, steps };
}

export function navCounts(userId) {
  return one(
    `SELECT count(*) FILTER (WHERE to_certify OR display_status = 'en_retard') AS factures,
            count(*) FILTER (WHERE to_certify OR display_status = 'en_retard'
                             OR (remaining > 0 AND due_date BETWEEN current_date AND current_date + 3)) AS notifications
     FROM invoice_overview WHERE user_id = $1`,
    [userId],
  );
}

export function aiUsageThisMonth(userId) {
  return one(
    `SELECT count(*) AS used, l.ai_actions_per_month AS quota
     FROM users u JOIN plan_limits l ON l.plan = u.plan
     LEFT JOIN ai_usage a ON a.user_id = u.id AND a.month = date_trunc('month', current_date)::date
     WHERE u.id = $1 GROUP BY l.ai_actions_per_month`,
    [userId],
  );
}

// Export de sauvegarde (règle 11) : tout ce qui appartient au compte, en JSON.
export async function exportAll(userId) {
  const tables = {
    profil: 'SELECT * FROM business_profiles WHERE user_id = $1',
    clients: 'SELECT * FROM clients WHERE user_id = $1',
    devis: 'SELECT * FROM quotes WHERE user_id = $1',
    lignes_devis: 'SELECT qi.* FROM quote_items qi JOIN quotes q ON q.id = qi.quote_id WHERE q.user_id = $1',
    factures: 'SELECT * FROM invoices WHERE user_id = $1',
    lignes_factures: 'SELECT ii.* FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.user_id = $1',
    certifications_fne: 'SELECT f.* FROM fne_certifications f JOIN invoices i ON i.id = f.invoice_id WHERE i.user_id = $1',
    paiements: 'SELECT * FROM payments WHERE user_id = $1',
    relances: 'SELECT * FROM reminders WHERE user_id = $1',
  };
  const out = { exporte_le: new Date().toISOString() };
  for (const [name, sql] of Object.entries(tables)) out[name] = await many(sql, [userId]);
  return out;
}

// --- Devis partagé ----------------------------------------------------------------------------

export async function getPublicQuote(id) {
  const q = await one(
    `SELECT q.*, to_jsonb(c) - 'notes' AS client, to_jsonb(p) - 'user_id' AS seller
     FROM quotes q JOIN clients c ON c.id = q.client_id
     JOIN business_profiles p ON p.user_id = q.user_id
     WHERE q.id = $1 AND q.status IN ('envoye', 'accepte', 'refuse', 'expire')`,
    [id],
  );
  if (!q) return null;
  q.items = await many('SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY position', [id]);
  return q;
}

export const markQuoteSent = (userId, id) =>
  one(
    `UPDATE quotes SET status = CASE WHEN status = 'brouillon' THEN 'envoye'::quote_status ELSE status END,
            sent_at = coalesce(sent_at, now())
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId],
  );

// --- Notifications (section 5) : retard, échéance sous 3 jours, facture à certifier -------------

export function notifications(userId) {
  return many(
    `SELECT o.id, o.number, o.kind, o.due_date, o.remaining, o.total_ttc, o.issue_date, c.name AS client_name,
            CASE WHEN o.to_certify THEN 'a_certifier'
                 WHEN o.display_status = 'en_retard' THEN 'en_retard'
                 ELSE 'echeance' END AS type,
            (current_date - o.due_date) AS days_late
     FROM invoice_overview o JOIN clients c ON c.id = o.client_id
     WHERE o.user_id = $1 AND (o.to_certify OR o.display_status = 'en_retard'
           OR (o.remaining > 0 AND o.due_date BETWEEN current_date AND current_date + 3))
     ORDER BY CASE WHEN o.to_certify THEN 0 WHEN o.display_status = 'en_retard' THEN 1 ELSE 2 END, o.due_date`,
    [userId],
  );
}

// --- Fiche client --------------------------------------------------------------------------------

export async function clientDetail(userId, id) {
  const client = await getClient(userId, id);
  if (!client) return null;
  client.invoices = await many(
    `SELECT o.id, o.number, o.kind, o.status, o.display_status, o.issue_date, o.due_date, o.total_ttc, o.remaining, o.to_certify
     FROM invoice_overview o WHERE o.user_id = $1 AND o.client_id = $2
     ORDER BY o.issue_date DESC NULLS FIRST, o.number DESC`,
    [userId, id],
  );
  client.quotes = await many('SELECT id, number, status, issue_date FROM quotes WHERE user_id = $1 AND client_id = $2 ORDER BY created_at DESC', [userId, id]);
  client.summary = await one(
    `SELECT coalesce(sum(o.total_ttc - o.credited) FILTER (WHERE o.kind = 'facture' AND o.status <> 'brouillon'), 0)::bigint AS billed,
            coalesce(sum(o.paid), 0)::bigint AS paid,
            coalesce(sum(o.remaining), 0)::bigint AS remaining,
            (SELECT avg_delay_days FROM client_payment_scores s WHERE s.client_id = $2) AS avg_delay_days
     FROM invoice_overview o WHERE o.user_id = $1 AND o.client_id = $2`,
    [userId, id],
  );
  return client;
}

// --- Statistiques avancées (Business) ----------------------------------------------------------------

export async function advancedStats(userId) {
  const byClient = await many(
    `SELECT c.id, c.name,
            coalesce(sum(o.total_ttc - o.credited) FILTER (WHERE o.kind = 'facture' AND o.status <> 'brouillon'), 0)::bigint AS billed,
            coalesce(sum(o.paid), 0)::bigint AS paid,
            coalesce(sum(o.remaining), 0)::bigint AS remaining,
            count(o.id) FILTER (WHERE o.kind = 'facture' AND o.status <> 'brouillon') AS invoices,
            s.avg_delay_days
     FROM clients c
     LEFT JOIN invoice_overview o ON o.client_id = c.id
     LEFT JOIN client_payment_scores s ON s.client_id = c.id
     WHERE c.user_id = $1
     GROUP BY c.id, c.name, s.avg_delay_days
     HAVING count(o.id) > 0
     ORDER BY billed DESC`,
    [userId],
  );
  const months = await many(
    `WITH m AS (SELECT generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month')::date AS month)
     SELECT m.month,
            (SELECT coalesce(sum(total_ht), 0)::bigint FROM invoices WHERE user_id = $1 AND kind = 'facture' AND status <> 'brouillon' AND date_trunc('month', issue_date) = m.month) AS ht,
            (SELECT coalesce(sum(total_vat), 0)::bigint FROM invoices WHERE user_id = $1 AND kind = 'facture' AND status <> 'brouillon' AND date_trunc('month', issue_date) = m.month) AS vat,
            (SELECT coalesce(sum(total_vat), 0)::bigint FROM invoices WHERE user_id = $1 AND kind = 'avoir' AND status <> 'brouillon' AND date_trunc('month', issue_date) = m.month) AS vat_credited,
            (SELECT coalesce(sum(amount), 0)::bigint FROM payments WHERE user_id = $1 AND date_trunc('month', payment_date) = m.month) AS cashed,
            (SELECT count(*) FROM invoices WHERE user_id = $1 AND kind = 'facture' AND status <> 'brouillon' AND date_trunc('month', issue_date) = m.month) AS count
     FROM m ORDER BY m.month`,
    [userId],
  );
  const methods = await many(
    `SELECT method, count(*) AS count, sum(amount)::bigint AS total FROM payments WHERE user_id = $1 GROUP BY method ORDER BY total DESC`,
    [userId],
  );
  const kpi = await one(
    `SELECT
       coalesce(avg(o.total_ttc) FILTER (WHERE o.kind = 'facture' AND o.status <> 'brouillon'), 0)::bigint AS avg_invoice,
       (SELECT round(avg(avg_delay_days), 1) FROM client_payment_scores WHERE user_id = $1) AS avg_delay,
       coalesce(sum(o.remaining) FILTER (WHERE o.display_status = 'en_retard'), 0)::bigint AS overdue,
       -- Délai moyen de recouvrement (DSO) sur 90 jours : encours / facturé * 90.
       CASE WHEN coalesce(sum(o.total_ttc) FILTER (WHERE o.kind = 'facture' AND o.status <> 'brouillon' AND o.issue_date >= current_date - 90), 0) = 0 THEN NULL
            ELSE round(sum(o.remaining) * 90.0 / sum(o.total_ttc) FILTER (WHERE o.kind = 'facture' AND o.status <> 'brouillon' AND o.issue_date >= current_date - 90))
       END AS dso
     FROM invoice_overview o WHERE o.user_id = $1`,
    [userId],
  );
  return { byClient, months, methods, kpi };
}

// --- Exports CSV (Business) ------------------------------------------------------------------------

export const CSV_EXPORTS = {
  factures: {
    label: 'Factures et avoirs',
    sql: `SELECT i.number AS numero, i.kind AS type, i.status AS statut, i.issue_date AS date_emission, i.due_date AS echeance,
                 c.name AS client, c.ncc AS ncc_client, i.total_ht AS total_ht, i.total_vat AS tva, i.total_ttc AS total_ttc,
                 o.paid AS encaisse, o.remaining AS reste_a_payer, f.fiscal_number AS numero_fiscal_fne, f.certified_at AS certifiee_le, r.number AS facture_origine
          FROM invoices i JOIN invoice_overview o ON o.id = i.id JOIN clients c ON c.id = i.client_id
          LEFT JOIN fne_certifications f ON f.invoice_id = i.id LEFT JOIN invoices r ON r.id = i.ref_invoice_id
          WHERE i.user_id = $1 AND i.status <> 'brouillon' ORDER BY i.issue_date, i.number`,
  },
  lignes: {
    label: 'Lignes de factures',
    sql: `SELECT i.number AS numero, ii.position AS ligne, ii.description AS designation, ii.qty AS quantite, ii.unit_price AS prix_unitaire_ht,
                 round(ii.qty * ii.unit_price)::bigint AS montant_ht, ii.vat_applicable AS soumis_tva
          FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
          WHERE i.user_id = $1 AND i.status <> 'brouillon' ORDER BY i.issue_date, i.number, ii.position`,
  },
  paiements: {
    label: 'Paiements',
    sql: `SELECT p.payment_date AS date, i.number AS facture, c.name AS client, p.amount AS montant, p.method AS moyen, p.reference
          FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN clients c ON c.id = i.client_id
          WHERE p.user_id = $1 ORDER BY p.payment_date`,
  },
  clients: {
    label: 'Clients',
    sql: `SELECT name AS nom, type, ncc, address AS adresse, phone AS telephone, email FROM clients WHERE user_id = $1 ORDER BY lower(name)`,
  },
};

export async function csvExport(userId, key) {
  const def = CSV_EXPORTS[key];
  if (!def) return null;
  const { rows, fields } = await query(def.sql, [userId]);
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    // Séparateur « ; » (Excel en français) ; neutralise les formules (=, +, -, @) à l'ouverture.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [fields.map((f) => f.name).join(';'), ...rows.map((r) => fields.map((f) => cell(r[f.name])).join(';'))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

// --- Abonnement ---------------------------------------------------------------------------------------

export async function planUsage(userId) {
  return one(
    `SELECT u.plan, l.*,
            (SELECT count(*) FROM invoices WHERE user_id = u.id AND kind = 'facture' AND created_at >= date_trunc('month', now())) AS invoices_month,
            (SELECT count(*) FROM clients WHERE user_id = u.id) AS clients_count,
            (SELECT count(*) FROM ai_usage WHERE user_id = u.id AND month = date_trunc('month', current_date)::date) AS ai_month
     FROM users u JOIN plan_limits l ON l.plan = u.plan WHERE u.id = $1`,
    [userId],
  );
}

export const billingHistory = (userId) =>
  many('SELECT * FROM billing_events WHERE user_id = $1 ORDER BY at DESC LIMIT 24', [userId]);

export function changePlan(userId, toPlan, { amount: price, method, reference, simulated }) {
  return tx(async (client) => {
    const { rows } = await client.query('SELECT plan FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const from = rows[0].plan;
    await client.query('UPDATE users SET plan = $2 WHERE id = $1', [userId, toPlan]);
    // Le logo est une option des plans payants : masqué en gratuit, réaffiché au retour sur un plan payant.
    await client.query(
      `UPDATE business_profiles SET logo_url = CASE WHEN $2 = 'gratuit' THEN NULL
         ELSE (SELECT '/logo/' || user_id || '?v=' || extract(epoch FROM updated_at)::bigint FROM business_logos WHERE user_id = $1) END
       WHERE user_id = $1`,
      [userId, toPlan],
    );
    await client.query(
      `INSERT INTO billing_events (user_id, from_plan, to_plan, amount, method, reference, simulated) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, from, toPlan, price, method, reference, simulated],
    );
    return from;
  });
}

export async function planAllows(userId, feature) {
  const row = await one(`SELECT l.${feature} AS ok FROM users u JOIN plan_limits l ON l.plan = u.plan WHERE u.id = $1`, [userId]);
  return Boolean(row?.ok);
}

// --- Logo ---------------------------------------------------------------------------------------------

export async function saveLogo(userId, mime, data) {
  await query(
    `INSERT INTO business_logos (user_id, mime, data) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, updated_at = now()`,
    [userId, mime, data],
  );
  // Le paramètre de version force le rafraîchissement ; les factures déjà émises gardent leur photographie.
  await query(`UPDATE business_profiles SET logo_url = '/logo/' || user_id || '?v=' || extract(epoch FROM now())::bigint WHERE user_id = $1`, [userId]);
}

export async function deleteLogo(userId) {
  await query('DELETE FROM business_logos WHERE user_id = $1', [userId]);
  await query('UPDATE business_profiles SET logo_url = NULL WHERE user_id = $1', [userId]);
}

// Données transmises à l'assistant IA : noms, montants, dates, statuts. Jamais de NCC, téléphone ni email.
export async function assistantContext(userId) {
  const invoices = await many(
    `SELECT o.number, o.kind, o.display_status AS statut, o.issue_date AS emise_le, o.due_date AS echeance,
            o.total_ttc, o.paid AS encaisse, o.remaining AS reste, c.name AS client, NOT o.to_certify AS certifiee
     FROM invoice_overview o JOIN clients c ON c.id = o.client_id
     WHERE o.user_id = $1 AND o.status <> 'brouillon' ORDER BY o.issue_date DESC LIMIT 200`,
    [userId],
  );
  const payments = await many(
    `SELECT p.payment_date AS date, p.amount AS montant, p.method AS moyen, i.number AS facture, c.name AS client
     FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN clients c ON c.id = i.client_id
     WHERE p.user_id = $1 ORDER BY p.payment_date DESC LIMIT 200`,
    [userId],
  );
  const reminders = await many(
    `SELECT r.sent_at::date AS date, r.tone AS ton, i.number AS facture FROM reminders r JOIN invoices i ON i.id = r.invoice_id
     WHERE r.user_id = $1 ORDER BY r.sent_at DESC LIMIT 100`,
    [userId],
  );
  const delays = await many(
    `SELECT c.name AS client, s.avg_delay_days AS retard_moyen_jours, s.paid_invoices AS factures_soldees
     FROM client_payment_scores s JOIN clients c ON c.id = s.client_id WHERE s.user_id = $1`,
    [userId],
  );
  return { aujourd_hui: new Date().toISOString().slice(0, 10), factures: invoices, paiements: payments, relances: reminders, delais_clients: delays };
}
