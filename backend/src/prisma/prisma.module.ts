import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Provides `PrismaService` app-wide; global so feature modules need not import it. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
