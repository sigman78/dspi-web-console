// Minifies an AutoEQ profile database ({version, generatedAt, entryCount,
// entries}) into the copy served from public/. The schema passes through
// unchanged, so any database in the same format is drop-in.
//
// Usage: node scripts/build-autoeq-db.mjs <path-to-autoeq_database.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/build-autoeq-db.mjs <autoeq_database.json>');
  process.exit(1);
}

const db = JSON.parse(readFileSync(src, 'utf8'));
for (const key of ['version', 'generatedAt', 'entryCount', 'entries']) {
  if (!(key in db)) {
    console.error(`input is not an AutoEQ database: missing "${key}"`);
    process.exit(1);
  }
}

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/autoeq-db.json');
writeFileSync(out, JSON.stringify(db));
console.log(`wrote ${out}: ${db.entryCount} entries, generated ${db.generatedAt}`);
