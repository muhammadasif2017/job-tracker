import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdminService } from './admin.service.js';
import { AdminController } from './admin.controller.js';
import { AdminQueuesService } from './admin-queues.service.js';
import { AdminQueuesController } from './admin-queues.controller.js';
import { UsersModule } from '../users/users.module.js';
import { COMPANY_ENRICHMENT_QUEUE } from '../companies/enrichment/company-enrichment.constants.js';
import { JOB_TIMELINE_SUMMARY_QUEUE } from '../timeline-summary/timeline-summary.constants.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor.js';

@Module({
  // Re-registering queues another module owns is how a read-only consumer gets
  // a handle on them — same pattern as HealthModule.
  imports: [
    UsersModule,
    BullModule.registerQueue({ name: COMPANY_ENRICHMENT_QUEUE }),
    BullModule.registerQueue({ name: JOB_TIMELINE_SUMMARY_QUEUE }),
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  providers: [AdminService, AdminQueuesService],
  controllers: [AdminController, AdminQueuesController],
})
export class AdminModule {}
