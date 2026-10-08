import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/** Garante que o banco de testes existe e está com todas as migrações aplicadas. */
export default async function globalSetup() {
  const url = process.env.DATABASE_URL_TEST ?? 'postgresql://boraali:boraali@localhost:5432/boraali_test?schema=public';
  const admin = new PrismaClient({ datasourceUrl: url.replace(/\/boraali_test\b/, '/postgres') });
  try {
    const exists = await admin.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = 'boraali_test'`;
    if (exists.length === 0) await admin.$executeRawUnsafe('CREATE DATABASE boraali_test');
  } finally {
    await admin.$disconnect();
  }
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
}
