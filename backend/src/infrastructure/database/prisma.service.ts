import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * The app's single `PrismaClient`, wired to Postgres through the pg driver
 * adapter. Prisma 7 has no `url` field in `datasource db {}`, so the
 * connection string is supplied here at runtime rather than in
 * `schema.prisma`.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    });
    super({ adapter });
  }

  /**
   * Runs one query at boot. With the pg driver adapter `$connect()` opens no
   * connection, so the process's first query paid for its first connection
   * and Prisma's first-query setup. After a deploy that was the first
   * `/health` probe: it took 5.9s and failed its 5s database ping on a
   * healthy database (seen on the VM after #444). How those 5.9s split
   * between setup and connecting was not measured; the first `/health` after
   * the next deploy is the check.
   *
   * It also makes a bad `DATABASE_URL` fail startup instead of the first
   * request. The database is required at boot either way: the production
   * image runs `prisma migrate deploy` before the app. Locally,
   * `npm run start:dev` now needs Postgres running.
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
