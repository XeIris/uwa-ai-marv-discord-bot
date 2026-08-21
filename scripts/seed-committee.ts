/**
 * One-off seed of the Committee table. Safe to re-run — every row is an upsert
 * keyed on (server, user, title).
 *
 * Usage: bun scripts/seed-committee.ts <guild-id>
 *
 * The roster itself lives in data/committee-seed.json, which is gitignored: it
 * maps real people's names to their Discord IDs and has no business in a public
 * repo. Copy data/committee-seed.example.json to get started.
 *
 * After seeding, keep the roster current with /committee add|update|remove
 * rather than editing the JSON — that's the whole point of putting it in the DB.
 */

import Database from '../database/Database';

interface SeedEntry {
  userId: string;
  title: string;
  displayName: string | null;
  isExecutive: boolean;
}

const SEED_PATH = `${import.meta.dir}/../data/committee-seed.json`;
const EXAMPLE_PATH = 'data/committee-seed.example.json';

function validate(raw: unknown, index: number): SeedEntry {
  const entry = raw as Record<string, unknown>;
  if (!entry || typeof entry !== 'object') {
    throw new Error(`members[${index}] is not an object`);
  }
  if (typeof entry.userId !== 'string' || !/^\d{17,20}$/.test(entry.userId)) {
    throw new Error(`members[${index}].userId must be a Discord snowflake string`);
  }
  if (typeof entry.title !== 'string' || entry.title.trim().length === 0) {
    throw new Error(`members[${index}].title must be a non-empty string`);
  }
  if (entry.displayName !== undefined && entry.displayName !== null && typeof entry.displayName !== 'string') {
    throw new Error(`members[${index}].displayName must be a string or null`);
  }
  return {
    userId: entry.userId,
    title: entry.title.trim(),
    displayName: (entry.displayName as string | null) ?? null,
    isExecutive: entry.isExecutive === true,
  };
}

async function loadRoster(): Promise<SeedEntry[]> {
  const file = Bun.file(SEED_PATH);
  if (!(await file.exists())) {
    throw new Error(
      'No roster found at data/committee-seed.json.\n'
      + `Copy ${EXAMPLE_PATH} to data/committee-seed.json and fill in your committee.\n`
      + '(It is gitignored on purpose — it holds real names and Discord IDs.)',
    );
  }

  const parsed = await file.json();
  const members = Array.isArray(parsed) ? parsed : parsed?.members;
  if (!Array.isArray(members) || members.length === 0) {
    throw new Error('data/committee-seed.json must contain a non-empty "members" array.');
  }
  return members.map(validate);
}

async function main(): Promise<void> {
  const guildId = process.argv[2];
  if (!guildId || !/^\d{17,20}$/.test(guildId)) {
    throw new Error('Usage: bun scripts/seed-committee.ts <guild-id>');
  }

  const roster = await loadRoster();

  // Same file the bot opens (classes/silverwolf.ts) — run this with the bot stopped.
  const db = new Database('./persistence/database.db');
  await db.ready;

  for (let i = 0; i < roster.length; i += 1) {
    const member = roster[i];

    await db.committee.upsert(guildId, member.userId, member.title, {
      displayName: member.displayName,
      isExecutive: member.isExecutive,
      // Preserve the order the roster file was written in.
      sortOrder: i + 1,
    });
  }

  const stored = await db.committee.listByServer(guildId);
  console.log(`Seeded ${roster.length} entries; roster now holds ${stored.length} for guild ${guildId}.`);
  db.db.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
