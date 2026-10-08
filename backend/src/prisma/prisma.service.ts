import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Bloqueia linhas (SELECT ... FOR UPDATE) dentro de uma transação, em ordem
   * determinística de ID para evitar deadlocks entre transações concorrentes.
   */
  async lockRows(tx: Tx, table: 'Trip' | 'TripDay' | 'Order', ids: string[]): Promise<void> {
    const unique = [...new Set(ids)].sort();
    if (unique.length === 0) return;
    await tx.$queryRawUnsafe(
      `SELECT id FROM "${table}" WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      unique,
    );
  }
}
