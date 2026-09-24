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
   * Connects eagerly at boot so a bad `DATABASE_URL` fails startup instead
   * of the first request that needs the database.
   */
  async onModuleInit() {
    await this.$connect();
  }

  /**
   * Closes the pool on shutdown so tests and dev restarts do not leak
   * connections.
   */
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
