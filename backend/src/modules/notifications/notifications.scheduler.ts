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
const DIGEST_SEND_HOUR = 8;

// Matches EnrichmentModule's queue.add options (see enrichment.service.ts) —
// a transient Redis/worker blip shouldn't permanently drop a reminder.
const JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'fixed' as const, delay: 10_000 },
};

// hourCycle: 'h23' avoids an ICU quirk where hour12: false formats midnight
// as "24" instead of "0" — that would silently make DIGEST_SEND_HOUR
// unreachable for a user in a zone where 08:00 UTC lands on their midnight.
function localHour(date: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(date),
  );
}

function isLocalMonday(date: Date, timeZone: string): boolean {
  return (
    new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(
      date,
    ) === 'Mon'
  );
}

// en-CA formats as YYYY-MM-DD directly, giving the user's local calendar
// date rather than the UTC one — this is what the dedup jobId is keyed on so
// a user near a UTC-midnight boundary can't get two digests for one local day.
function localDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

@Injectable()
export class NotificationsScheduler {
  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
  ) {}

  // Explicit UTC everywhere below: without it, node-cron runs on the host's
  // local tz, which drifts from the UTC-labelled times in templates.ts and
  // from the UTC calendar date used to build the digest dedup jobId — plus
  // it's the only way to be safe from an hour being skipped/repeated across
  // a host-local DST transition.
  @Cron(CronExpression.EVERY_HOUR, { timeZone: 'UTC' })
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

  // Hourly, not a fixed daily/weekly cron: each user's local 08:00 lands in
  // a different UTC hour, so this scans every hour and fanOutDigest filters
  // to whichever users are at their local send hour right now.
  @Cron(CronExpression.EVERY_HOUR, { timeZone: 'UTC' })
  async sendDailyDigests(): Promise<void> {
    await this.fanOutDigest(DigestFrequency.DAILY);
  }

  @Cron(CronExpression.EVERY_HOUR, { timeZone: 'UTC' })
  async sendWeeklyDigests(): Promise<void> {
    await this.fanOutDigest(DigestFrequency.WEEKLY);
  }

  private async fanOutDigest(frequency: DigestFrequency): Promise<void> {
    const now = new Date();
    const users = await this.prisma.user.findMany({
      where: { digestFrequency: frequency },
      select: { id: true, timezone: true },
    });

    for (const { id: userId, timezone } of users) {
      try {
        if (localHour(now, timezone) !== DIGEST_SEND_HOUR) continue;
        if (
          frequency === DigestFrequency.WEEKLY &&
          !isLocalMonday(now, timezone)
        )
          continue;
      } catch (error) {
        // A malformed timezone (e.g. hand-edited via Prisma Studio — see
        // backend CLAUDE.md's admin/role note that direct DB edits are a
        // normal ops path here) would otherwise throw out of the `for`
        // loop entirely, silently skipping the digest for every other user
        // this tick. Contain the blast radius to just this one user.
        this.logger.warn('digest_invalid_timezone', {
          userId,
          timezone,
          error,
        });
        continue;
      }

      const items = await getAttentionItems(this.prisma, userId);
      if (!items.length) continue;

      const data: DigestJobData = { userId };
      // Deterministic jobId keyed by user+frequency+day: BullMQ treats a
      // second add() with the same jobId as a no-op rather than a duplicate
      // job, guarding against a restart or multi-instance race re-firing the
      // same cron window twice for the same user.
      const dateKey = localDateKey(now, timezone);
      await this.queue.add('digest', data, {
        ...JOB_OPTIONS,
        jobId: `digest-${frequency}-${userId}-${dateKey}`,
      });
      this.logger.log('digest_enqueued', { userId, itemCount: items.length });
    }
  }
}
