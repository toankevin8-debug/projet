// Routes de l'application ajoutées au cœur du cycle de facturation : notifications, abonnement,
// statistiques et exports (Business), assistant et relances IA, PDF, envoi par email,
// certification automatique, logo, mot de passe, devis partagés.
import express from 'express';
import { one, query, userMessage } from './db.js';
import * as data from './data.js';
import { amount, longDate } from './html.js';
import { text, whatsappLink } from './forms.js';
import { hashPassword, verifyPassword } from './auth.js';
import { sendVerification } from './account-routes.js';
import { MAIL_ENABLED, baseUrl, sendMail } from './mailer.js';
import { buildInvoicePdf, sendInvoicePdf } from './pdf.js';
import { FNE_AUTOMATIC, FneError, certifyAutomatically } from './fne.js';
import { AI_ENABLED, QuotaError, answerQuestion, commentForecast, expressBlock, withQuota, writeReminder, writeReminders } from './ai.js';
import { dashboardPage } from './views/dashboard.js';
import { suggestedTone } from './views/invoices.js';
import {
  assistantPage, batchRemindersPage, forecastComment, notificationsPage, reminderDraftPage, statsPage, subscriptionPage, upsell,
} from './views/extra.js';

const PRICES = { gratuit: 0, pro: 2000, business: 5000 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function registerExtraRoutes(router) {
  // --- Email : renvoi du lien de vérification -----------------------------------------------
  router.post('/verifier-email/renvoyer', async (req, res) => {
    if (!req.user.email_verified_at) await sendVerification(req, req.user);
    res.redirect('/app?ok=lien_envoye');
  });

  // --- Notifications ----------------------------------------------------------------------------
  router.get('/notifications', async (req, res) => {
    const [items, u] = await Promise.all([data.notifications(req.user.id), one('SELECT notify_email FROM users WHERE id = $1', [req.user.id])]);
    res.send(String(notificationsPage({ user: req.user, items, navCounts: req.navCounts, notifyEmail: u.notify_email })));
  });

  // --- Abonnement --------------------------------------------------------------------------------
  const showSubscription = async (req, res, extra = {}) => {
    const [usage, history] = await Promise.all([data.planUsage(req.user.id), data.billingHistory(req.user.id)]);
    return res.status(extra.status || 200).send(String(subscriptionPage({ user: req.user, usage, history, navCounts: req.navCounts, ...extra })));
  };
  router.get('/abonnement', (req, res) => showSubscription(req, res, { message: req.query.ok === 'plan' ? 'Votre plan a été mis à jour.' : null, simulated: req.query.ok === 'plan' }));

  router.post('/abonnement', async (req, res) => {
    const plan = req.body.plan;
    if (!(plan in PRICES) || plan === req.user.plan) return res.redirect('/app/abonnement');
    const method = PRICES[plan] > 0 ? (['wave', 'orange_money', 'mtn_money', 'moov_money'].includes(req.body.method) ? req.body.method : null) : null;
    if (PRICES[plan] > 0 && !method) return showSubscription(req, res, { error: 'Choisissez un moyen de paiement.', status: 422 });
    // Agrégateur Mobile Money non branché : le changement est simulé et tracé comme tel (cahier des charges, section 8).
    await data.changePlan(req.user.id, plan, { amount: PRICES[plan], method, reference: null, simulated: true });
    return res.redirect('/app/abonnement?ok=plan');
  });

  // --- Statistiques et exports (Business) -------------------------------------------------------
  router.get('/statistiques', async (req, res) => {
    if (!(await data.planAllows(req.user.id, 'advanced_stats'))) {
      return res.send(String(upsell({
        user: req.user, navCounts: req.navCounts, active: 'statistiques', title: 'Statistiques', plan: 'business',
        pitch: 'Voyez qui vous fait vivre, qui vous fait attendre, et préparez votre TVA mois par mois.',
        points: ['Chiffre d’affaires, encaissements et retard moyen par client', 'Délai de recouvrement (DSO) sur 90 jours', 'TVA collectée par mois, avoirs déduits', 'Exports CSV pour votre comptable'],
      })));
    }
    const stats = await data.advancedStats(req.user.id);
    return res.send(String(statsPage({ user: req.user, stats, navCounts: req.navCounts, exports: data.CSV_EXPORTS })));
  });

  router.get('/exports/:key.csv', async (req, res) => {
    if (!(await data.planAllows(req.user.id, 'csv_export'))) return res.redirect('/app/statistiques');
    const csv = await data.csvExport(req.user.id, req.params.key);
    if (!csv) return res.status(404).send('Export inconnu');
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="freefact-${req.params.key}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
  });

  // --- PDF de facture (application) ----------------------------------------------------------------
  router.get('/factures/:id/pdf', async (req, res) => {
    const inv = await data.getInvoice(req.user.id, req.params.id);
    if (!inv || inv.status === 'brouillon') return res.status(404).send('Facture introuvable ou non émise');
    return sendInvoicePdf(res, inv);
  });

  // --- Envoi réel par email, PDF joint (exige un email vérifié et un SMTP configuré) --------------------
  router.post('/factures/:id/email', async (req, res) => {
    const inv = await data.getInvoice(req.user.id, req.params.id);
    if (!inv || inv.status === 'brouillon') return res.status(404).send('Facture introuvable');
    const back = (error) => res.redirect(`/app/factures/${inv.id}?${error ? `erreur=${encodeURIComponent(error)}` : 'ok=email'}`);
    const to = text(req.body.to)?.toLowerCase();
    if (!MAIL_ENABLED) return back('L’envoi d’emails n’est pas configuré sur ce serveur.');
    if (!req.user.email_verified_at) return back('Confirmez d’abord votre adresse email (bandeau en haut de page).');
    if (!to || !EMAIL.test(to)) return back('Adresse email du client invalide.');
    try {
      await data.markSent(req.user.id, inv.id); // refusé par la base si la facture n'est pas certifiée
    } catch (err) {
      return back(userMessage(err) || 'Envoi impossible.');
    }
    const s = inv.seller_snapshot;
    const result = await sendMail({
      userId: req.user.id,
      to,
      subject: `${inv.kind === 'avoir' ? 'Facture d’avoir' : 'Facture'} ${inv.number} · ${s.business_name}`,
      text: `Bonjour,\n\nVeuillez trouver ci-joint la ${inv.kind === 'avoir' ? 'facture d’avoir' : 'facture'} ${inv.number} de ${s.business_name}, d’un montant de ${amount(inv.total_ttc).replace(/ /g, ' ')} FCFA${inv.kind === 'facture' ? `, payable avant le ${longDate(inv.due_date)}` : ''}.\n\nVersion en ligne : ${baseUrl(req)}/f/${inv.id}\n\n${s.business_name}${s.phone ? `\n${s.phone}` : ''}${s.email ? `\n${s.email}` : ''}`,
      attachments: [{ filename: `${inv.number}.pdf`, content: await buildInvoicePdf(inv) }],
    });
    if (!inv.client.email) await query('UPDATE clients SET email = $3 WHERE id = $1 AND user_id = $2', [inv.client_id, req.user.id, to]);
    return back(result.sent ? null : `L’email n’a pas pu partir : ${result.error || 'erreur inconnue'}.`);
  });

  // --- Certification automatique (Business, après agrément ou en simulation) ---------------------------
  router.post('/factures/:id/certifier-auto', async (req, res) => {
    const inv = await data.getInvoice(req.user.id, req.params.id);
    if (!inv || inv.status === 'brouillon') return res.status(404).send('Facture introuvable');
    const back = (q) => res.redirect(`/app/factures/${inv.id}?${q}`);
    if (!FNE_AUTOMATIC || !(await data.planAllows(req.user.id, 'fne_api_certification'))) return back('erreur=' + encodeURIComponent('Certification automatique indisponible sur votre plan ou ce serveur.'));
    try {
      const cert = await certifyAutomatically(inv);
      await data.certifyInvoice(req.user.id, inv.id, { ...cert, mode: 'api' });
      return back('ok=certifiee');
    } catch (err) {
      const msg = err instanceof FneError ? err.message : userMessage(err);
      if (!msg) throw err;
      return back('erreur=' + encodeURIComponent(msg));
    }
  });

  // --- Relance rédigée par l'IA ----------------------------------------------------------------------
  const reminderFacts = (req, inv, tone, channel = 'whatsapp') => ({
    number: inv.number,
    client: inv.buyer_snapshot.name,
    remaining: amount(inv.remaining).replace(/ /g, ' '),
    due: longDate(inv.due_date),
    daysLate: Math.max(0, Math.floor((Date.now() - new Date(`${inv.due_date}T00:00:00Z`)) / 86400000)),
    previous: inv.reminders?.length ?? 0,
    seller: inv.seller_snapshot.business_name,
    url: `${baseUrl(req)}/f/${inv.id}`,
    channel,
    tone,
  });

  router.post('/factures/:id/relance-ia', async (req, res) => {
    const inv = await data.getInvoice(req.user.id, req.params.id);
    if (!inv || !inv.certification) return res.status(404).send('Facture introuvable ou non certifiée');
    const tone = ['amical', 'cordial', 'ferme', 'dernier_rappel'].includes(req.body.tone) ? req.body.tone : suggestedTone(inv.due_date);
    const page = (message, error) => res.send(String(reminderDraftPage({ user: req.user, inv, message, tone, navCounts: req.navCounts, error })));
    if (!AI_ENABLED) return res.redirect(`/app/factures/${inv.id}`);
    try {
      const message = await withQuota(req.user.id, 'relance', () => writeReminder(reminderFacts(req, inv, tone)));
      if (!message) return page('', 'L’IA n’a pas pu rédiger ce message. Écrivez-le vous-même ci-dessous.');
      return page(message);
    } catch (err) {
      if (err instanceof QuotaError) return page('', err.message);
      console.error('Relance IA :', err);
      return page('', 'Le service IA ne répond pas. Écrivez le message vous-même, ou réessayez plus tard.');
    }
  });

  // --- Relances en lot (Business) -------------------------------------------------------------------
  async function overdueForBatch(req) {
    const rows = await data.openInvoices(req.user.id);
    return rows
      .filter((r) => r.display_status === 'en_retard' && !r.to_certify)
      .map((r) => ({ ...r, days_late: Math.floor((Date.now() - new Date(`${r.due_date}T00:00:00Z`)) / 86400000), tone: suggestedTone(r.due_date) }));
  }

  router.get('/relances', async (req, res) => {
    if (!(await data.planAllows(req.user.id, 'batch_ai_reminders'))) {
      return res.send(String(upsell({
        user: req.user, navCounts: req.navCounts, active: 'factures', title: 'Relances en lot', plan: 'business',
        pitch: 'Toutes vos factures en retard relancées en une fois, chacune au ton qui convient.',
        points: ['Un message par facture, rédigé selon le retard', 'Relecture et modification avant envoi', 'Envoi WhatsApp en un geste, relance enregistrée'],
      })));
    }
    const items = await overdueForBatch(req);
    return res.send(String(batchRemindersPage({ user: req.user, items, navCounts: req.navCounts, aiEnabled: AI_ENABLED })));
  });

  router.post('/relances', async (req, res) => {
    if (!(await data.planAllows(req.user.id, 'batch_ai_reminders'))) return res.redirect('/app/relances');
    const items = await overdueForBatch(req);
    const render = (drafts, error) => res.send(String(batchRemindersPage({ user: req.user, items, drafts, navCounts: req.navCounts, error, aiEnabled: AI_ENABLED })));
    if (!AI_ENABLED || items.length === 0) return render(null);
    try {
      const facts = [];
      for (const i of items) {
        const inv = await data.getInvoice(req.user.id, i.id);
        facts.push(reminderFacts(req, inv, i.tone));
      }
      const drafts = await withQuota(req.user.id, 'relances_lot', () => writeReminders(facts));
      return render(drafts, drafts ? null : 'L’IA n’a pas pu rédiger ces messages ; les modèles standards restent disponibles.');
    } catch (err) {
      console.error('Relances en lot :', err);
      return render(null, err instanceof QuotaError ? err.message : 'Le service IA ne répond pas ; les modèles standards restent disponibles.');
    }
  });

  // --- Assistant financier -------------------------------------------------------------------------------
  const showAssistant = async (req, res, error) => {
    const [messages, usage] = await Promise.all([
      query('SELECT role, content FROM (SELECT * FROM assistant_messages WHERE user_id = $1 ORDER BY id DESC LIMIT 20) m ORDER BY id', [req.user.id]).then((r) => r.rows),
      data.aiUsageThisMonth(req.user.id),
    ]);
    return res.status(error ? 422 : 200).send(String(assistantPage({ user: req.user, messages, navCounts: req.navCounts, error, usage })));
  };
  router.get('/assistant', (req, res) => (AI_ENABLED ? showAssistant(req, res) : res.redirect('/app')));

  router.post('/assistant', async (req, res) => {
    if (!AI_ENABLED) return res.redirect('/app');
    const question = text(req.body.question)?.slice(0, 500);
    if (!question) return showAssistant(req, res, 'Écrivez votre question.');
    const history = (await query('SELECT role, content FROM (SELECT * FROM assistant_messages WHERE user_id = $1 ORDER BY id DESC LIMIT 10) m ORDER BY id', [req.user.id])).rows;
    try {
      const answer = await withQuota(req.user.id, 'assistant', async () => answerQuestion(question, history, await data.assistantContext(req.user.id)));
      await query('INSERT INTO assistant_messages (user_id, role, content) VALUES ($1, $2, $3), ($1, $4, $5)', [
        req.user.id, 'user', question, 'assistant', answer || 'Je ne peux pas répondre à cette question.',
      ]);
      return res.redirect('/app/assistant');
    } catch (err) {
      if (err instanceof QuotaError) return showAssistant(req, res, err.message);
      console.error('Assistant :', err);
      return showAssistant(req, res, 'Le service IA ne répond pas pour l’instant. Réessayez dans un moment.');
    }
  });

  router.post('/assistant/effacer', async (req, res) => {
    await query('DELETE FROM assistant_messages WHERE user_id = $1', [req.user.id]);
    res.redirect('/app/assistant');
  });

  // --- Prévisions commentées par l'IA (affichées sur le tableau de bord) ----------------------------------
  router.post('/previsions-ia', async (req, res) => {
    if (!AI_ENABLED) return res.redirect('/app');
    const dash = await data.dashboard(req.user.id);
    const clients = await data.listClients(req.user.id);
    const facts = {
      attendu_7_jours_fcfa: dash.forecast.expected_7_days,
      attendu_30_jours_fcfa: dash.forecast.expected_30_days,
      en_retard_fcfa: dash.figures.overdue,
      factures_en_retard: Number(dash.figures.overdue_count),
      reste_a_encaisser_fcfa: dash.figures.outstanding,
      clients: clients.filter((c) => c.remaining > 0 || c.avg_delay_days != null)
        .map((c) => ({ client: c.name, reste_du_fcfa: c.remaining, retard_moyen_jours: c.avg_delay_days == null ? null : Number(c.avg_delay_days) })),
    };
    let comment;
    try {
      comment = await withQuota(req.user.id, 'previsions', () => commentForecast(facts));
    } catch (err) {
      comment = err instanceof QuotaError ? err.message : 'Le service IA ne répond pas pour l’instant.';
    }
    const usage = await data.aiUsageThisMonth(req.user.id);
    return res.send(String(dashboardPage({
      user: req.user, data: dash, counts: req.navCounts, express: expressBlock({ usage }), forecast: forecastComment(comment),
    })));
  });

  // --- Paramètres : logo, mot de passe, notifications ------------------------------------------------------
  const LOGO_TYPES = { 'image/png': 1, 'image/jpeg': 1, 'image/webp': 1, 'image/svg+xml': 1 };
  router.post('/parametres/logo', express.raw({ type: Object.keys(LOGO_TYPES), limit: '300kb' }), async (req, res) => {
    if (!(await data.planAllows(req.user.id, 'custom_logo'))) return res.status(403).json({ error: 'Le logo est disponible à partir du plan Pro.' });
    const mime = req.get('content-type')?.split(';')[0];
    if (!LOGO_TYPES[mime] || !Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(415).json({ error: 'Format accepté : PNG, JPEG, WebP ou SVG, 300 Ko au plus.' });
    if (mime === 'image/svg+xml' && /<script|on\w+\s*=|javascript:/i.test(req.body.toString('utf8'))) return res.status(415).json({ error: 'Ce SVG contient du code : exportez-le en PNG.' });
    await data.saveLogo(req.user.id, mime, req.body);
    return res.json({ ok: true });
  });

  router.post('/parametres/logo/supprimer', async (req, res) => {
    await data.deleteLogo(req.user.id);
    res.redirect('/app/parametres?ok=profil');
  });

  router.post('/parametres/mot-de-passe', async (req, res) => {
    const back = (q) => res.redirect(`/app/parametres?${q}#securite`);
    const row = await one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const current = String(req.body.current || '');
    const next = String(req.body.password || '');
    if (row.password_hash && !(await verifyPassword(current, row.password_hash))) return back('erreur=' + encodeURIComponent('Mot de passe actuel incorrect.'));
    if (next.length < 8) return back('erreur=' + encodeURIComponent('Le nouveau mot de passe doit faire au moins 8 caractères.'));
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, await hashPassword(next)]);
    // Les autres sessions sont fermées ; la session courante reste ouverte.
    await query(`DELETE FROM sessions WHERE user_id = $1 AND created_at < now() - interval '1 second'`, [req.user.id]);
    return back('ok=mdp');
  });

  router.post('/parametres/notifications', async (req, res) => {
    await query('UPDATE users SET notify_email = $2 WHERE id = $1', [req.user.id, req.body.notify_email === '1']);
    res.redirect('/app/parametres?ok=profil#notifications');
  });

  // --- Devis : envoi au client ----------------------------------------------------------------------------
  router.post('/devis/:id/envoyer', async (req, res) => {
    const q = await data.markQuoteSent(req.user.id, req.params.id);
    if (!q) return res.status(404).send('Devis introuvable');
    const full = await data.getQuote(req.user.id, q.id);
    const total = full.items.reduce((s, it) => s + Math.round(Number(it.qty) * it.unit_price), 0);
    const msg = `Bonjour ${full.client.name},\n\nVoici notre devis ${q.number}, d’un montant de ${amount(total)} FCFA HT${q.valid_until ? `, valable jusqu’au ${longDate(q.valid_until)}` : ''}.\n\n${baseUrl(req)}/d/${q.id}\n\nNous restons à votre disposition.`;
    return res.redirect(whatsappLink(text(req.body.phone) || full.client.phone, msg));
  });
}

