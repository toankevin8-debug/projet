import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const root = new URL('../db/', import.meta.url);

export async function migrate() {
  const { rows } = await pool.query(
    "SELECT 1 FROM information_schema.schemata WHERE schema_name = 'freefact'",
  );
  if (rows.length === 0) {
    await pool.query(await readFile(new URL('schema.sql', root), 'utf8'));
  }
  await pool.query(await readFile(new URL('app.sql', root), 'utf8'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => {
      console.log('Base à jour.');
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
