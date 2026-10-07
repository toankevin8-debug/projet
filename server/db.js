import pg from 'pg';

// Les montants sont des bigint en FCFA : on les lit comme nombres (bien en deçà de 2^53).
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// Dates sans heure : on garde la chaîne ISO, sans conversion de fuseau.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost/freefact',
  max: Number(process.env.PG_POOL_SIZE || 10),
  options: '-c search_path=freefact,public',
});

export function query(text, params) {
  return pool.query(text, params);
}

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] ?? null;
}

export async function many(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

// Exécute fn dans une transaction ; fn reçoit un client dédié.
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Les règles métier refusées par la base (check_violation, clé étrangère, unicité)
// remontent à l'utilisateur avec leur message ; le reste est une erreur serveur.
const USER_FACING = new Set(['23514', '23503', '23505', 'P0002']);

export function userMessage(err) {
  if (!USER_FACING.has(err.code)) return null;
  if (err.code === '23505') return 'Cet enregistrement existe déjà.';
  if (err.code === '23503') return 'Référence introuvable ou encore utilisée.';
  return err.message;
}
