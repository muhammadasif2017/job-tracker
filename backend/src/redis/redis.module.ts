import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service.js';

/** Provides `RedisService` app-wide; global so feature modules need not import it. */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
