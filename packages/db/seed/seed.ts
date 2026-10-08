/** CLI seed: DATABASE_URL bo'lsa Postgres, bo'lmasa demo (memory). */
import { createDatabase, disconnectPrisma } from '../src/index.js';
import { applySeed } from './apply.js';

async function main(): Promise<void> {
  const { db, mode } = await createDatabase();
  console.log(`[seed] mode=${mode}`);
  await applySeed(db);
  await disconnectPrisma();
}

main().catch((err) => {
  console.error('[seed] FAILED', err);
  process.exit(1);
});
