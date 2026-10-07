// Envoi d'emails. Chaque message est d'abord écrit dans la table outbox, puis envoyé par SMTP
// si SMTP_URL est configuré (ex. smtps://user:pass@smtp.exemple.ci:465). Sans SMTP, le message
// reste dans outbox et le lien utile est écrit dans les journaux : rien ne se perd en local.
import nodemailer from 'nodemailer';
import { one, query } from './db.js';

export const MAIL_ENABLED = Boolean(process.env.SMTP_URL);
const FROM = process.env.MAIL_FROM || 'FreeFact <no-reply@freefact.ci>';
let transport;

export async function sendMail({ userId = null, to, subject, text, attachments = [] }) {
  const row = await one(
    `INSERT INTO outbox (user_id, to_address, subject, body_text, attachment_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, to, subject, text, attachments[0]?.filename ?? null],
  );
  if (!MAIL_ENABLED) {
    if (process.env.NODE_ENV !== 'test') console.log(`[email non envoyé, SMTP absent] à ${to} : ${subject}\n${text}\n`);
    return { sent: false, id: row.id };
  }
  try {
    transport ??= nodemailer.createTransport(process.env.SMTP_URL);
    await transport.sendMail({ from: FROM, to, subject, text, attachments });
    await query('UPDATE outbox SET sent_at = now() WHERE id = $1', [row.id]);
    return { sent: true, id: row.id };
  } catch (err) {
    await query('UPDATE outbox SET error = $2 WHERE id = $1', [row.id, String(err.message).slice(0, 500)]);
    console.error('Envoi email :', err.message);
    return { sent: false, id: row.id, error: err.message };
  }
}

export function baseUrl(req) {
  return process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
}
