import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { DB_POOL_OPTIONS } from './database.constants.js';

/**
 * The app's single `PrismaClient`, wired to Postgres through the pg driver
 * adapter. Prisma 7 has no `url` field in `datasource db {}`, so the
 * connection string is supplied here at runtime rather than in
 * `schema.prisma`, with the pool settings in `DB_POOL_OPTIONS`.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      ...DB_POOL_OPTIONS,
    });
    super({ adapter });
  }

  /**
   * Runs one query at boot. With the pg driver adapter `$connect()` opens
   * no connection, so this is what makes a bad `DATABASE_URL` fail startup
   * instead of the first request, and it moves the pool's first connection
   * and Prisma's first-query setup out of the first request too. The
   * database was already required to start: the production image runs
   * `prisma migrate deploy` before the app, and that fails without it.
   */
  async onModuleInit() {
    await this.$queryRaw`SELECT 1`;
  }

  /**
   * Closes the pool on shutdown so tests and dev restarts do not leak
   * connections.
   */
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
