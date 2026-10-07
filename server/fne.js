// Certification FNE automatique (plan Business, section 7 du cahier des charges).
//
// L'interfaçage par API exige l'autorisation du Directeur général des impôts, et le contrat
// d'interface n'est communiqué qu'avec cet agrément. Ce module est le seul endroit à adapter :
//
//   FNE_MODE=manuel      (défaut) certification guidée : l'utilisateur saisit le numéro fiscal.
//   FNE_MODE=api         envoi à FNE_API_URL avec FNE_API_TOKEN. Le format de requête et de réponse
//                        ci-dessous est une hypothèse de travail, à aligner sur la documentation DGI.
//   FNE_MODE=simulation  numéros fictifs « SIM-… », refusé en production. Sert à tester le parcours.
import { randomBytes } from 'node:crypto';

export const FNE_MODE = ['api', 'simulation'].includes(process.env.FNE_MODE) ? process.env.FNE_MODE : 'manuel';
export const FNE_SIMULATION = FNE_MODE === 'simulation' && process.env.NODE_ENV !== 'production';
export const FNE_AUTOMATIC = FNE_SIMULATION || (FNE_MODE === 'api' && Boolean(process.env.FNE_API_URL));

if (FNE_MODE === 'simulation' && process.env.NODE_ENV === 'production') {
  console.warn('FNE_MODE=simulation ignoré en production.');
}

export class FneError extends Error {}

// Données envoyées à la DGI : la photographie de la facture émise, rien d'autre.
function payload(inv) {
  return {
    type: inv.kind === 'avoir' ? 'avoir' : 'facture',
    numero: inv.number,
    facture_origine: inv.ref_number ?? null,
    date_emission: inv.issue_date,
    vendeur: { ncc: inv.seller_snapshot.ncc, raison_sociale: inv.seller_snapshot.business_name, regime: inv.seller_snapshot.tax_regime },
    client: { nom: inv.buyer_snapshot.name, ncc: inv.buyer_snapshot.ncc ?? null, type: inv.buyer_snapshot.type },
    lignes: inv.items.map((it) => ({ designation: it.description, quantite: Number(it.qty), prix_unitaire_ht: it.unit_price, tva: inv.vat_applicable && it.vat_applicable })),
    taux_tva: Number(inv.vat_rate),
    total_ht: inv.total_ht,
    total_tva: inv.total_vat,
    total_ttc: inv.total_ttc,
  };
}

export async function certifyAutomatically(inv) {
  if (FNE_SIMULATION) {
    return {
      fiscal_number: `SIM-${new Date().getFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`,
      certified_at: new Date().toISOString(),
      qr_reference: `SIM-QR-${randomBytes(3).toString('hex').toUpperCase()}`,
      document_url: null,
      api_response: { simulation: true, avertissement: 'Certification simulée, sans valeur fiscale' },
    };
  }
  if (FNE_MODE !== 'api' || !process.env.FNE_API_URL) throw new FneError('Certification automatique non configurée.');

  let res;
  try {
    res = await fetch(process.env.FNE_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.FNE_API_TOKEN || ''}` },
      body: JSON.stringify(payload(inv)),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new FneError('La plateforme FNE ne répond pas. La facture reste « à certifier » ; réessayez quand le réseau revient.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.numero_fiscal) {
    throw new FneError(`Certification refusée par la plateforme FNE${body.message ? ` : ${String(body.message).slice(0, 200)}` : '.'}`);
  }
  return {
    fiscal_number: body.numero_fiscal,
    certified_at: body.date_certification || new Date().toISOString(),
    qr_reference: body.reference_qr ?? null,
    document_url: body.url_document ?? null,
    api_response: body,
  };
}
