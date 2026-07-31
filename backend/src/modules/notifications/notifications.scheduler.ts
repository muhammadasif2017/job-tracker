import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DigestFrequency, InterviewOutcome } from '@prisma/client';
import type { Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service.js';
import { getAttentionItems } from '../jobs/attention.helper.js';
import {
  NOTIFICATIONS_QUEUE,
  type InterviewReminderJobData,
  type DigestJobData,
} from './notifications.processor.js';

const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

// Matches EnrichmentModule's queue.add options (see enrichment.service.ts) —
// a transient Redis/worker blip shouldn't permanently drop a reminder.
const JOB_OPTIONS = { attempts: 2, backoff: { type: 'fixed' as const, delay: 10_000 } };

@Injectable()
export class NotificationsScheduler {
  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async scanInterviewReminders(): Promise<void> {
    const now = new Date();
    const in24h = new Date(now.getTime() + REMINDER_LEAD_MS);

    const rounds = await this.prisma.interviewRound.findMany({
      where: {
        outcome: InterviewOutcome.PENDING,
        scheduledAt: { gte: now, lte: in24h },
        reminderSentAt: null,
        job: { user: { interviewRemindersEnabled: true } },
      },
      select: { id: true },
    });

    for (const { id } of rounds) {
      // Stamp before enqueue: a crash here means the reminder is silently
      // skipped, never that it's double-sent. Compare-and-swap on
      // reminderSentAt guards against a concurrent scan claiming the same row.
      const { count } = await this.prisma.interviewRound.updateMany({
        where: { id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (count === 0) continue;

      const data: InterviewReminderJobData = { roundId: id };
      await this.queue.add('interview-reminder', data, JOB_OPTIONS);
      this.logger.log('interview_reminder_enqueued', { roundId: id });
    }
  }

  @Cron('0 8 * * *')
  async sendDailyDigests(): Promise<void> {
    await this.fanOutDigest(DigestFrequency.DAILY);
  }

  @Cron('0 8 * * 1')
  async sendWeeklyDigests(): Promise<void> {
    await this.fanOutDigest(DigestFrequency.WEEKLY);
  }

  private async fanOutDigest(frequency: DigestFrequency): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { digestFrequency: frequency },
      select: { id: true },
    });

    for (const { id: userId } of users) {
      const items = await getAttentionItems(this.prisma, userId);
      if (!items.length) continue;

      const data: DigestJobData = { userId };
      // Deterministic jobId keyed by user+frequency+day: BullMQ treats a
      // second add() with the same jobId as a no-op rather than a duplicate
      // job, guarding against a restart or multi-instance race re-firing the
      // same cron window twice for the same user.
      const dateKey = new Date().toISOString().slice(0, 10);
      await this.queue.add('digest', data, {
        ...JOB_OPTIONS,
        jobId: `digest-${frequency}-${userId}-${dateKey}`,
      });
      this.logger.log('digest_enqueued', { userId, itemCount: items.length });
    }
  }
}
