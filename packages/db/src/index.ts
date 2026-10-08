import type { Database } from '@app/shared';
import { createPrismaClient, disconnectPrisma } from './client.js';
import { PrismaDatabase } from './prisma-db.js';

export { PrismaDatabase } from './prisma-db.js';
export { applySeed } from '../seed/apply.js';
export { createPrismaClient, disconnectPrisma } from './client.js';

/**
 * Database factory:
 *  - DATABASE_URL bo'lsa - PostgreSQL (Prisma)
 *  - bo'lmasa - demo rejimi (in-memory, MemoryDatabase)
 */
export async function createDatabase(demoMode?: boolean): Promise<{ db: Database; mode: 'postgres' | 'memory' }> {
  const url = process.env.DATABASE_URL;
  const forceDemo = demoMode === true || process.env.DEMO_MODE === 'true' || !url;
  if (forceDemo) {
    const { MemoryDatabase } = await import('@app/shared');
    return { db: new MemoryDatabase(), mode: 'memory' };
  }
  const client = await createPrismaClient();
  return { db: new PrismaDatabase(client), mode: 'postgres' };
}
