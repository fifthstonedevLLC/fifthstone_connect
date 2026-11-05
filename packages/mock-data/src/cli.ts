import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeedFiles } from './seed.js';

/**
 * `npm run seed:build`: regenerates every file in supabase/seed/ from the catalog. Generated
 * files the catalog no longer produces are removed, so the folder always matches the catalog.
 */
const seedDir = fileURLToPath(new URL('../../../supabase/seed/', import.meta.url));
const files = buildSeedFiles();

for (const existing of readdirSync(seedDir)) {
  if (existing.endsWith('.sql') && !files.has(existing)) rmSync(join(seedDir, existing));
}
for (const [name, contents] of files) writeFileSync(join(seedDir, name), contents);

process.stdout.write(`Wrote ${files.size} seed files to supabase/seed/\n`);
