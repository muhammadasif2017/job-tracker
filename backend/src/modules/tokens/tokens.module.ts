import { Module } from '@nestjs/common';
import { TokensService } from './tokens.service.js';
import { TokensController } from './tokens.controller.js';

@Module({
  providers: [TokensService],
  controllers: [TokensController],
})
export class TokensModule {}
