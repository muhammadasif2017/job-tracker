import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DigestFrequency, InterviewOutcome } from '@prisma/client';
import type { Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { isCommandTimeout } from '../../infrastructure/redis/redis-errors.helper.js';
import {
  cronRequestId,
  runWithRequestId,
  withRequestId,
} from '../../common/request-context.helper.js';
import { getAttentionItems } from '../jobs/attention.helper.js';
import {
  NOTIFICATIONS_QUEUE,
  type InterviewReminderJobData,
  type DigestJobData,
} from './notifications.processor.js';

/** How far ahead of `scheduledAt` a round becomes due for its reminder. */
const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
/** The user-local hour digests go out at. */
const DIGEST_SEND_HOUR = 8;

/**
 * Matches EnrichmentModule's `queue.add` options (see enrichment.service.ts):
 * a transient Redis or worker blip should not permanently drop a reminder.
 */
const JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'fixed' as const, delay: 10_000 },
};

/**
 * The hour (0–23) an instant falls on in `timeZone`. `hourCycle: 'h23'`
 * avoids an ICU quirk where `hour12: false` formats midnight as "24" instead
 * of "0", which would silently make `DIGEST_SEND_HOUR` unreachable for a user
 * in a zone where 08:00 UTC lands on their midnight.
 */
function localHour(date: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(date),
  );
}

/** Whether an instant falls on a Monday in `timeZone`. Weekly digests go out then. */
function isLocalMonday(date: Date, timeZone: string): boolean {
  return (
    new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(
      date,
    ) === 'Mon'
  );
}

/**
 * The user's local calendar date as YYYY-MM-DD (en-CA formats that way
 * directly). The digest dedup jobId is keyed on this rather than the UTC date,
 * so a user near a UTC-midnight boundary cannot get two digests for one local
 * day.
 */
function localDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}

/**
 * Hourly crons that decide what is due and enqueue it on the notifications
 * queue; `NotificationsProcessor` does the sending.
 *
 * Every cron pins `timeZone: 'UTC'`. Without it, node-cron runs on the host's
 * local zone, which drifts from the UTC-labelled times in templates.ts and
 * can skip or repeat an hour across a host-local DST transition.
 */
@Injectable()
export class NotificationsScheduler {
  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
  ) {}

  /**
   * Claims and enqueues a reminder for every pending round starting within the
   * next 24 hours. Each round is stamped before it is enqueued, so a crash
   * between the two skips a reminder rather than sending it twice.
   */
  @Cron(CronExpression.EVERY_HOUR, { timeZone: 'UTC' })
  async scanInterviewReminders(): Promise<void> {
    // One correlation ID per scan, shared by its log lines and the jobs it
    // enqueues (ADR-049).
    return runWithRequestId(cronRequestId('interview-reminders'), () =>
      this.runReminderScan(),
    );
  }

  /** The reminder scan itself; see `scanInterviewReminders`. */
  private async runReminderScan(): Promise<void> {
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
      try {
        await this.queue.add(
          'interview-reminder',
          withRequestId(data),
          JOB_OPTIONS,
        );
      } catch (err) {
        // Queue adds fail fast on a Redis outage (ADR-046). A refused add
        // queued nothing, so un-stamp the round and the next hourly scan
        // retries it. A timed-out add may have run in Redis with only the
        // reply lost, so the stamp stays: un-stamping could send the
        // reminder twice, and this scan skips rather than double-sends.
        // Either way stop the scan — every later add would fail the same way.
        const refused = !isCommandTimeout(err);
        if (refused) {
          await this.prisma.interviewRound.updateMany({
            where: { id, reminderSentAt: now },
            data: { reminderSentAt: null },
          });
        }
        this.logger.warn('interview_reminder_enqueue_failed', {
          roundId: id,
          unstamped: refused,
          err,
        });
        return;
      }
      this.logger.log('interview_reminder_enqueued', { roundId: id });
    }
  }

  /**
   * Enqueues daily digests. Hourly, not a fixed daily cron: each user's local
   * 08:00 lands in a different UTC hour, so this runs every hour and
   * `fanOutDigest` keeps whichever users are at their send hour now.
   */
  @Cron(CronExpression.EVERY_HOUR, { timeZone: 'UTC' })
  async sendDailyDigests(): Promise<void> {
    await runWithRequestId(cronRequestId('daily-digests'), () =>
      this.fanOutDigest(DigestFrequency.DAILY),
    );
  }

  /** Enqueues weekly digests; hourly for the same reason as the daily cron. */
  @Cron(CronExpression.EVERY_HOUR, { timeZone: 'UTC' })
  async sendWeeklyDigests(): Promise<void> {
    await runWithRequestId(cronRequestId('weekly-digests'), () =>
      this.fanOutDigest(DigestFrequency.WEEKLY),
    );
  }

  /**
   * Enqueues a digest for each user on `frequency` whose local time is the
   * send hour (and a Monday, for weekly), skipping users with nothing needing
   * attention. A bad timezone skips only that user.
   */
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
      await this.queue.add('digest', withRequestId(data), {
        ...JOB_OPTIONS,
        jobId: `digest-${frequency}-${userId}-${dateKey}`,
      });
      this.logger.log('digest_enqueued', { userId, itemCount: items.length });
    }
  }
}
