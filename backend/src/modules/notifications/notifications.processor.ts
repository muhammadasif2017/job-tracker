import { OnWorkerEvent, Processor } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DigestFrequency, InterviewOutcome } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { getAttentionItems } from '../jobs/attention.helper.js';
import { EmailService } from './email.service.js';
import { interviewReminderEmail, digestEmail } from './templates.js';
import { withWorkerConnection } from '../../infrastructure/redis/redis-connection.helper.js';
import { runJobWithRequestId } from '../../common/request-context.helper.js';
import { CorrelatedWorkerHost } from '../../common/correlated-worker-host.js';
import { appLogger } from '../../infrastructure/error-tracking/app-logger.helper.js';

/** BullMQ queue carrying interview reminders and digest emails. */
export const NOTIFICATIONS_QUEUE = 'notifications';

/** Payload of an `interview-reminder` job. */
export type InterviewReminderJobData = { roundId: string };
/** Payload of a `digest` job. */
export type DigestJobData = { userId: string };

/**
 * Attention reasons that stay true until the user acts, so the digest stamps
 * them once reported instead of repeating them every day.
 */
type DedupAttentionType = 'STALE_APPLIED' | 'STALE_INTERVIEWING';

/** Narrows an attention item type to one the digest dedups. */
function isDedupType(type: string): type is DedupAttentionType {
  return type === 'STALE_APPLIED' || type === 'STALE_INTERVIEWING';
}

/** The `Job` column that records when this reason was last put in a digest. */
function dedupField(
  type: DedupAttentionType,
): 'staleAppliedDigestedAt' | 'staleInterviewingDigestedAt' {
  return type === 'STALE_APPLIED'
    ? 'staleAppliedDigestedAt'
    : 'staleInterviewingDigestedAt';
}

/**
 * Worker for the notifications queue. Jobs are enqueued by
 * `NotificationsScheduler`, which has already claimed each interview round
 * by stamping `reminderSentAt`; this side re-checks state at send time,
 * because the round or the user's preferences can change while the job
 * waits on the queue.
 */
@Injectable()
@Processor(NOTIFICATIONS_QUEUE, withWorkerConnection({}))
export class NotificationsProcessor extends CorrelatedWorkerHost<
  Job<InterviewReminderJobData | DigestJobData>
> {
  private readonly logger = appLogger(NotificationsProcessor);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  /**
   * Dispatches a queue job by name to its handler. Unknown names are
   * ignored. Jobs carry the correlation ID of the cron scan that enqueued
   * them (ADR-049).
   */
  protected async handle(
    job: Job<InterviewReminderJobData | DigestJobData>,
  ): Promise<void> {
    if (job.name === 'interview-reminder') {
      await this.processInterviewReminder(job.data as InterviewReminderJobData);
    } else if (job.name === 'digest') {
      await this.processDigest(job.data as DigestJobData);
    }
  }

  /**
   * Releases an interview round's claim once BullMQ has exhausted every
   * attempt (see `JOB_OPTIONS` in notifications.scheduler.ts). Without this,
   * a permanently failed send — a Resend outage, say — leaves
   * `reminderSentAt` stamped forever, and the hourly scan's
   * `reminderSentAt: null` filter never picks the round up again. Digests
   * need no equivalent: they stamp only after a successful send.
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<InterviewReminderJobData | DigestJobData> | undefined,
  ): Promise<void> {
    if (!job || job.name !== 'interview-reminder') return;
    if (job.attemptsMade < (job.opts.attempts ?? 1)) return; // will retry itself

    // Worker events fire outside `process`, so this runs in the job's
    // correlation context by hand; otherwise the one line explaining why
    // the round was un-stamped would carry no requestId (ADR-049).
    await runJobWithRequestId(job, async () => {
      const { roundId } = job.data as InterviewReminderJobData;
      await this.prisma.interviewRound.updateMany({
        where: { id: roundId, reminderSentAt: { not: null } },
        data: { reminderSentAt: null },
      });
      this.logger.warn(
        {
          roundId,
        },
        'interview_reminder_permanently_failed_reset',
      );
    });
  }

  /** Base URL for links in email bodies. */
  private frontendUrl(): string {
    return this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
  }

  /**
   * Sends the 24-hour reminder for one round. Skips a round whose outcome is
   * no longer pending, and clears the claim rather than sending when the user
   * has turned reminders off, so re-enabling them before the interview still
   * produces a reminder.
   */
  private async processInterviewReminder({
    roundId,
  }: InterviewReminderJobData): Promise<void> {
    const round = await this.prisma.interviewRound.findUnique({
      where: { id: roundId },
      include: {
        job: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                interviewRemindersEnabled: true,
                timezone: true,
              },
            },
          },
        },
      },
    });
    if (!round) {
      this.logger.warn({ roundId }, 'notification_round_not_found');
      return;
    }
    // Outcome may have changed (e.g. cancelled) between the hourly scan
    // stamping reminderSentAt and this job being picked up off the queue.
    if (round.outcome !== InterviewOutcome.PENDING) return;

    const { user } = round.job;
    if (!user.interviewRemindersEnabled) {
      // Don't leave reminderSentAt stamped: if the user re-enables reminders
      // before the interview happens, the hourly scan should pick this round
      // up again instead of treating it as already handled.
      await this.prisma.interviewRound.updateMany({
        where: { id: roundId, reminderSentAt: { not: null } },
        data: { reminderSentAt: null },
      });
      return;
    }

    const { subject, html } = interviewReminderEmail({
      company: round.job.company,
      position: round.job.position,
      stage: round.stage,
      scheduledAt: round.scheduledAt,
      timezone: user.timezone,
      frontendUrl: this.frontendUrl(),
    });
    await this.email.send({ to: user.email, subject, html });
    this.logger.log({ roundId, userId: user.id }, 'interview_reminder_sent');
  }

  /**
   * Builds and sends one user's digest from the live attention list, then
   * stamps the deduped reasons it reported. The stamp happens only after the
   * send succeeds and never throws, for the reasons given at the stamp below.
   */
  private async processDigest({ userId }: DigestJobData): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, digestFrequency: true },
    });
    if (!user || user.digestFrequency === DigestFrequency.OFF) return;

    const allItems = await getAttentionItems(this.prisma, userId);
    // STALE_APPLIED/STALE_INTERVIEWING are "still unresolved" reasons that
    // otherwise repeat in every digest forever — once reported, suppress
    // until the underlying `since` moves (i.e. the occurrence actually
    // changes). UPCOMING_INTERVIEW isn't deduped: its 48h window self-
    // resolves in a couple of days on its own.
    const items = allItems.filter((item) => {
      if (!isDedupType(item.type)) return true;
      const digestedAt = item.job[dedupField(item.type)];
      return !digestedAt || digestedAt < item.since;
    });
    if (!items.length) return;

    const { subject, html } = digestEmail({
      items: items.map((item) => ({
        type: item.type,
        company: item.job.company,
        position: item.job.position,
        since: item.since,
      })),
      frontendUrl: this.frontendUrl(),
    });
    await this.email.send({ to: user.email, subject, html });

    // Stamp only after a successful send: a thrown/retried send leaves these
    // unstamped so the retry (or, if attempts run out, tomorrow's digest)
    // still includes them — no separate onFailed handling needed here.
    // A stamp failure itself (e.g. the job was deleted between computing the
    // digest and writing this) must NOT throw here — the email already went
    // out, so throwing would fail this BullMQ job and cause a retry that
    // re-sends the same email a second time. Worst case on a stamp failure:
    // that one item repeats in the next digest, same as before this dedup
    // existed — a real regression (duplicate email) would be worse.
    const now = new Date();
    await Promise.all(
      items
        .filter((item) => isDedupType(item.type))
        .map((item) =>
          this.prisma.job
            .update({
              where: { id: item.job.id },
              data: { [dedupField(item.type as DedupAttentionType)]: now },
            })
            .catch((error) =>
              this.logger.warn(
                {
                  jobId: item.job.id,
                  err: error,
                },
                'digest_dedup_stamp_failed',
              ),
            ),
        ),
    );
    this.logger.log({ userId, itemCount: items.length }, 'digest_sent');
  }
}
