import { Module } from '@nestjs/common';
import { InterviewRoundsService } from './interview-rounds.service.js';
import { InterviewRoundsController } from './interview-rounds.controller.js';

@Module({
  providers: [InterviewRoundsService],
  controllers: [InterviewRoundsController],
})
export class InterviewRoundsModule {}
