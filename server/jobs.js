// Tâches de fond. Une seule pour l'instant : le récapitulatif quotidien des notifications par email
// (retards, échéances sous 3 jours, factures à certifier), au plus un par compte et par jour ;
// la table notifications_sent garde la trace de ce qui a été signalé.
import { many, query } from './db.js';
import { amount, longDate } from './html.js';
import { sendMail } from './mailer.js';

const LABELS = {
  a_certifier: 'À certifier sur la FNE (envoi bloqué en attendant)',
  en_retard: 'En retard de paiement',
  echeance: 'Échéance dans les 3 jours',
};

export async function sendDailyDigests({ appUrl = process.env.PUBLIC_URL || 'http://localhost:3000' } = {}) {
  const rows = await many(
    `SELECT u.id AS user_id, u.email, u.fullname, o.id AS invoice_id, o.number, o.remaining, o.total_ttc, o.due_date, c.name AS client,
            CASE WHEN o.to_certify THEN 'a_certifier' WHEN o.display_status = 'en_retard' THEN 'en_retard' ELSE 'echeance' END AS kind
     FROM users u
     JOIN invoice_overview o ON o.user_id = u.id
     JOIN clients c ON c.id = o.client_id
     WHERE u.notify_email AND u.email_verified_at IS NOT NULL
       AND (o.to_certify OR o.display_status = 'en_retard' OR (o.remaining > 0 AND o.due_date BETWEEN current_date AND current_date + 3))
       -- Un seul récapitulatif par compte et par jour.
       AND NOT EXISTS (SELECT 1 FROM notifications_sent n WHERE n.user_id = u.id AND n.day = current_date)
     ORDER BY u.id, kind, o.due_date`,
  );
  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r);
  }
  let sent = 0;
  for (const [userId, items] of byUser) {
    const first = items[0];
    const sections = Object.keys(LABELS)
      .map((kind) => {
        const list = items.filter((i) => i.kind === kind);
        if (!list.length) return '';
        return `${LABELS[kind]} :\n${list.map((i) => `  · ${i.number} — ${i.client} — ${amount(kind === 'a_certifier' ? i.total_ttc : i.remaining)} FCFA${kind === 'a_certifier' ? '' : `, échéance ${longDate(i.due_date)}`}`).join('\n')}`;
      })
      .filter(Boolean)
      .join('\n\n');
    await sendMail({
      userId,
      to: first.email,
      subject: `FreeFact : ${items.length} facture${items.length > 1 ? 's' : ''} à traiter aujourd’hui`,
      text: `Bonjour ${first.fullname},\n\n${sections.replace(/ /g, ' ')}\n\nOuvrir FreeFact : ${appUrl}/app/notifications\n\nVous recevez ce récapitulatif au plus une fois par jour. Pour l’arrêter : Paramètres → Notifications.\n`,
    });
    for (const i of items) {
      await query('INSERT INTO notifications_sent (user_id, kind, invoice_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [userId, i.kind, i.invoice_id]);
    }
    sent += 1;
  }
  return sent;
}

// Toutes les heures ; le récapitulatif part entre 7 h et 19 h (heure d'Abidjan = UTC).
export function startJobs() {
  if (process.env.DISABLE_JOBS === '1') return;
  const tick = async () => {
    const hour = new Date().getUTCHours();
    if (hour < 7 || hour > 19) return;
    try {
      await sendDailyDigests();
    } catch (err) {
      console.error('Récapitulatif quotidien :', err);
    }
  };
  setTimeout(tick, 30 * 1000);
  setInterval(tick, 60 * 60 * 1000).unref();
}
