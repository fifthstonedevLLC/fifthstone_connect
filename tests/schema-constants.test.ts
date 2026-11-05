import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOLD_STATES, LEAD_SOURCES, LEAD_STATES, REQUEST_STATES, URGENCIES } from '@fsc/core';

// The TypeScript state lists and the database check constraints describe the same thing. This
// fails if a value is added to one side only.
const migrations = readdirSync(new URL('../supabase/migrations/', import.meta.url))
  .sort()
  .map((f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8'))
  .join('\n');

/** Values in `<column> text ... check (<column> in (...))` within a table's definition. */
function checkList(table: string, column: string): string[] {
  const start = migrations.indexOf(`create table ${table} (`);
  if (start < 0) throw new Error(`No table ${table}`);
  const definition = migrations.slice(start, migrations.indexOf('\n);', start));
  const match = new RegExp(`${column} text[^,]*?check \\(${column} in \\(([^)]*)\\)\\)`, 's').exec(
    definition,
  );
  if (!match?.[1]) throw new Error(`No check list for ${table}.${column}`);
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? '');
}

describe('schema constants match the migrations', () => {
  it.each([
    ['app.leads', 'state', LEAD_STATES],
    ['app.leads', 'source', LEAD_SOURCES],
    ['app.leads', 'urgency', URGENCIES],
    ['app.requests', 'state', REQUEST_STATES],
    ['app.calendar_holds', 'state', HOLD_STATES],
  ])('%s.%s', (table, column, values) => {
    expect(checkList(table, column)).toEqual([...values]);
  });
});
