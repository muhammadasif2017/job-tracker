import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  NotificationsProcessor,
  NOTIFICATIONS_QUEUE,
} from './notifications.processor.js';
import { NotificationsScheduler } from './notifications.scheduler.js';
import { EmailService } from './email.service.js';

@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })],
  providers: [NotificationsProcessor, NotificationsScheduler, EmailService],
  exports: [EmailService],
})
export class NotificationsModule {}
