// Prisma client - lazy loading.
// @prisma/client paketini import qilganda (generate bo'lmasa) u darhol xato beradi,
// shuning uchun client faqat createPrismaClient() ichida dinamic import qilinadi.
// Testlar va demo rejimi hech qachon bu funksiyani chaqirmaydi.

export type PrismaClientLike = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let cached: PrismaClientLike = null;

export async function createPrismaClient(): Promise<PrismaClientLike> {
  if (cached) return cached;
  const mod = await import('@prisma/client');
  const { PrismaClient } = mod as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  cached = new PrismaClient({
    log: process.env.PRISMA_LOG === 'query' ? ['query', 'error', 'warn'] : ['error', 'warn'],
  });
  return cached;
}

export async function disconnectPrisma(): Promise<void> {
  if (cached) {
    await cached.$disconnect();
    cached = null;
  }
}
