// Facture express : une phrase (tapée ou dictée) devient un brouillon de facture ou de devis.
// L'IA prépare, elle n'émet jamais. Seuls partent vers le modèle la phrase et les noms des
// clients existants : ni NCC, ni téléphone, ni email.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { html } from './html.js';
import { many, one, userMessage } from './db.js';
import * as data from './data.js';

export const AI_ENABLED = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const MODEL = process.env.FREEFACT_AI_MODEL || 'claude-opus-5-5';

let client;
const anthropic = () => (client ??= new Anthropic());

const Draft = z.object({
  kind: z.enum(['facture', 'devis']).describe('« devis » seulement si la phrase parle de devis ou de proforma'),
  client_name: z.string().nullable().describe('Nom du client tel que dit, ou celui de la liste qui lui correspond ; null si absent'),
  terms_days: z.number().int().nullable().describe('Délai de paiement en jours si la phrase le donne, sinon null'),
  lines: z.array(z.object({
    description: z.string().describe('Désignation courte, en français, avec majuscule initiale'),
    qty: z.number().describe('Quantité ; 1 si non précisée'),
    unit_price: z.number().int().describe('Prix unitaire HT en FCFA ; 0 si la phrase ne le donne pas'),
  })),
});

const SYSTEM = `Tu prépares des brouillons de factures pour un freelance ou une petite entreprise en Côte d'Ivoire.
Les montants sont en francs CFA, sans décimales. « 25 000 », « 25k », « 25 mille » valent 25000.
Règles impératives :
- Un prix que la phrase ne donne pas vaut 0. Tu ne devines jamais un montant.
- « 3 affiches à 25 000 » : 3 lignes d'affiches à 25000 chacune, soit qty 3 et unit_price 25000. « 3 affiches pour 75 000 » : qty 3, unit_price 25000.
- Si le client correspond à un nom de la liste fournie, reprends ce nom exactement.
- N'invente ni client, ni ligne, ni délai.`;

export async function parseSentence(sentence, clientNames) {
  const response = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(Draft) },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: `Clients existants : ${clientNames.length ? clientNames.join(' ; ') : '(aucun)'}\n\nPhrase : ${sentence}`,
    }],
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) return null;
  return response.parsed_output;
}

export function expressBlock({ usage, error, sentence = '' }) {
  if (!AI_ENABLED) return '';
  const left = usage.quota == null ? null : Math.max(0, usage.quota - usage.used);
  return html`<form method="post" action="/app/express" class="side-box" style="margin-bottom:28px" data-express>
    <span class="eyebrow">Facture express</span>
    <label class="field" style="margin:8px 0 10px"><span class="visually-hidden">Décrivez la vente</span>
      <textarea name="sentence" rows="2" required maxlength="600" placeholder="Ex. 3 affiches à 25 000 et un logo à 80 000 pour la Boulangerie des Deux-Plateaux, paiement sous 15 jours">${sentence}</textarea></label>
    ${error ? html`<p class="small" style="color:var(--bad);margin:0 0 10px">${error}</p>` : ''}
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn btn--small" type="submit" ${left === 0 ? html`disabled` : ''}>Préparer le brouillon</button>
      <button class="btn btn--ghost btn--small" type="button" data-dictate hidden>Dicter</button>
      <span class="small muted">${left == null ? 'Actions IA illimitées' : `${left} action${left > 1 ? 's' : ''} IA restante${left > 1 ? 's' : ''} ce mois`}. Vous relirez avant d’émettre.</span>
    </div>
  </form>`;
}

const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function registerAiRoutes(router) {
  router.post('/express', async (req, res) => {
    const sentence = typeof req.body.sentence === 'string' ? req.body.sentence.trim().slice(0, 600) : '';
    const fail = async (error) => {
      const { dashboardPage } = await import('./views/dashboard.js');
      const [dash, usage] = await Promise.all([data.dashboard(req.user.id), data.aiUsageThisMonth(req.user.id)]);
      return res.status(422).send(String(dashboardPage({
        user: req.user, data: dash, counts: req.navCounts, express: expressBlock({ usage, error, sentence }),
      })));
    };
    if (!AI_ENABLED) return res.redirect('/app');
    if (!sentence) return fail('Décrivez ce que vous avez vendu.');

    const usage = await data.aiUsageThisMonth(req.user.id);
    if (usage.quota != null && usage.used >= usage.quota) {
      return fail(`Quota IA du mois atteint (${usage.quota} actions). Passez au plan supérieur pour continuer.`);
    }

    const clients = await many('SELECT id, name FROM clients WHERE user_id = $1', [req.user.id]);
    let draft;
    try {
      draft = await parseSentence(sentence, clients.map((c) => c.name));
    } catch (err) {
      console.error('Facture express :', err);
      return fail('Le service IA ne répond pas pour l’instant. Réessayez dans un moment, ou saisissez la facture à la main.');
    }
    if (!draft || draft.lines.length === 0) return fail('Je n’ai pas reconnu de ligne à facturer dans cette phrase.');
    if (!draft.client_name) return fail('Précisez pour quel client : « … pour la Boulangerie des Deux-Plateaux ».');

    try {
      await one('SELECT record_ai_usage($1, $2)', [req.user.id, 'facture_express']);

      // Client existant si le nom correspond, sinon créé sans coordonnées (à compléter avant émission).
      let clientId = clients.find((c) => normalize(c.name) === normalize(draft.client_name))?.id;
      if (!clientId) clientId = (await data.saveClient(req.user.id, null, { type: 'particulier', name: draft.client_name })).id;

      const items = draft.lines.map((l) => ({
        description: l.description.slice(0, 300),
        qty: l.qty > 0 ? l.qty : 1,
        unit_price: Math.max(0, Math.round(l.unit_price)),
        vat_applicable: true,
      }));
      if (draft.kind === 'devis') {
        const id = await data.saveQuote(req.user.id, null, { client_id: clientId, valid_until: null, notes: null, items });
        return res.redirect(`/app/devis/${id}?ok=devis`);
      }
      const id = await data.saveInvoiceDraft(req.user.id, null, {
        client_id: clientId,
        terms_days: draft.terms_days ?? req.user.profile.default_terms_days,
        vat_applicable: req.user.profile.vat_applicable,
        notes: null,
        items,
      });
      return res.redirect(`/app/factures/${id}?ok=brouillon`);
    } catch (err) {
      const msg = userMessage(err);
      if (!msg) throw err;
      return fail(msg);
    }
  });
}

// =====================================================================================
// Relances, assistant financier, commentaire des prévisions
// =====================================================================================

// Vérifie le quota avant l'appel, l'enregistre après succès (record_ai_usage revérifie en base).
export class QuotaError extends Error {}
export async function withQuota(userId, action, fn) {
  const usage = await data.aiUsageThisMonth(userId);
  if (usage.quota != null && usage.used >= usage.quota) {
    throw new QuotaError(`Quota IA du mois atteint (${usage.quota} actions). Passez au plan supérieur depuis la page Abonnement.`);
  }
  const result = await fn();
  await one('SELECT record_ai_usage($1, $2)', [userId, action]);
  return result;
}

async function askText({ system, messages, maxTokens = 2000, effort = 'low' }) {
  const response = await anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort },
    system,
    messages,
  });
  if (response.stop_reason === 'refusal') return null;
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim() || null;
}

async function askJson(schema, { system, content, maxTokens = 4000 }) {
  const response = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') return null;
  return response.parsed_output ?? null;
}

const REMINDER_SYSTEM = `Tu rédiges des relances de paiement pour un freelance ou une petite entreprise en Côte d'Ivoire, en français.
Ton demandé : amical (simple rappel, on suppose un oubli), cordial (rappel poli, on demande une date de paiement), ferme (rappel net, on attend le règlement rapidement), dernier_rappel (dernier message avant d'autres démarches, sans les détailler).
Règles impératives :
- Aucune menace, aucune loi ni article cité, aucune pénalité chiffrée, aucun délai inventé.
- Reprends exactement le numéro de facture, le montant restant et la date d'échéance fournis ; n'invente aucun autre chiffre.
- Inclus le lien de la facture tel quel.
- Pour WhatsApp : 4 à 6 phrases courtes, pas d'objet. Pour un email : même longueur, sans objet ni signature de logiciel.
- Signe avec le nom de l'entreprise fourni.`;

const reminderFacts = (r) =>
  `Facture ${r.number} · client : ${r.client} · reste à payer : ${r.remaining} FCFA · échéance : ${r.due} (${r.daysLate} jour(s) de retard) · relances déjà envoyées : ${r.previous} · entreprise : ${r.seller} · lien : ${r.url} · canal : ${r.channel} · ton : ${r.tone}`;

export async function writeReminder(r) {
  const out = await askJson(z.object({ message: z.string() }), { system: REMINDER_SYSTEM, content: reminderFacts(r) });
  return out?.message ?? null;
}

export async function writeReminders(list) {
  const out = await askJson(
    z.object({ relances: z.array(z.object({ numero: z.string(), message: z.string() })) }),
    {
      system: `${REMINDER_SYSTEM}\nTu reçois plusieurs factures : rédige un message par facture, dans le ton indiqué pour chacune.`,
      content: list.map(reminderFacts).join('\n'),
      maxTokens: 12000,
    },
  );
  return out?.relances ?? null;
}

export async function commentForecast(facts) {
  return askText({
    system: `Tu commentes les prévisions de trésorerie d'un freelance ivoirien, en français, en 5 lignes au plus.
Tu ne fais aucun calcul et tu n'inventes aucun chiffre : tu reprends seulement ceux fournis.
Tu signales ce qui mérite une action (retards importants, client habituellement lent, concentration sur un client) et tu restes concret.`,
    messages: [{ role: 'user', content: JSON.stringify(facts) }],
    maxTokens: 1200,
  });
}

const ASSISTANT_SYSTEM = `Tu es l'assistant financier de FreeFact, un logiciel de facturation pour freelances et petites entreprises en Côte d'Ivoire.
Tu réponds en français, brièvement, à partir des seules données du compte fournies en JSON (factures émises, paiements, relances, délais de paiement par client).
Règles :
- Si l'information n'est pas dans les données, dis-le ; ne l'invente pas. Les montants sont en FCFA.
- Les factures « certifiee: false » attendent leur numéro fiscal FNE et ne peuvent pas être envoyées.
- Pour toute question fiscale (TVA, régime, déclarations, obligations FNE), donne au plus une indication générale et renvoie vers la DGI (fne.dgi.gouv.ci) ou un expert-comptable.
- Pas de mise en forme Markdown lourde : phrases courtes, listes simples si besoin.`;

export async function answerQuestion(question, history, context) {
  return askText({
    system: [
      { type: 'text', text: ASSISTANT_SYSTEM },
      { type: 'text', text: `Données du compte :\n${JSON.stringify(context)}`, cache_control: { type: 'ephemeral' } },
    ],
    messages: [...history.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: question }],
    maxTokens: 2000,
    effort: 'medium',
  });
}
