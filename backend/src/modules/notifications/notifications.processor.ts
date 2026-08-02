import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DigestFrequency, InterviewOutcome } from '@prisma/client';
import type { Job } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service.js';
import { getAttentionItems } from '../jobs/attention.helper.js';
import { EmailService } from './email.service.js';
import { interviewReminderEmail, digestEmail } from './templates.js';

export const NOTIFICATIONS_QUEUE = 'notifications';

export type InterviewReminderJobData = { roundId: string };
export type DigestJobData = { userId: string };

type DedupAttentionType = 'STALE_APPLIED' | 'STALE_INTERVIEWING';

function isDedupType(type: string): type is DedupAttentionType {
  return type === 'STALE_APPLIED' || type === 'STALE_INTERVIEWING';
}

function dedupField(
  type: DedupAttentionType,
): 'staleAppliedDigestedAt' | 'staleInterviewingDigestedAt' {
  return type === 'STALE_APPLIED'
    ? 'staleAppliedDigestedAt'
    : 'staleInterviewingDigestedAt';
}

@Injectable()
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(
    job: Job<InterviewReminderJobData | DigestJobData>,
  ): Promise<void> {
    if (job.name === 'interview-reminder') {
      await this.processInterviewReminder(
        job.data as InterviewReminderJobData,
      );
    } else if (job.name === 'digest') {
      await this.processDigest(job.data as DigestJobData);
    }
  }

  // Runs once BullMQ has exhausted all configured attempts (see JOB_OPTIONS
  // in notifications.scheduler.ts). Without this, a permanently failed send
  // (e.g. Resend outage) leaves reminderSentAt stamped forever, silently
  // losing the reminder — the hourly scan's `reminderSentAt: null` filter
  // would otherwise never pick the round up again.
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<InterviewReminderJobData | DigestJobData> | undefined,
  ): Promise<void> {
    if (!job || job.name !== 'interview-reminder') return;
    if (job.attemptsMade < (job.opts.attempts ?? 1)) return; // will retry itself

    const { roundId } = job.data as InterviewReminderJobData;
    await this.prisma.interviewRound.updateMany({
      where: { id: roundId, reminderSentAt: { not: null } },
      data: { reminderSentAt: null },
    });
    this.logger.warn('interview_reminder_permanently_failed_reset', {
      roundId,
    });
  }

  private frontendUrl(): string {
    return this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
  }

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
      this.logger.warn('notification_round_not_found', { roundId });
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
    this.logger.log('interview_reminder_sent', { roundId, userId: user.id });
  }

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
              this.logger.warn('digest_dedup_stamp_failed', {
                jobId: item.job.id,
                error,
              }),
            ),
        ),
    );
    this.logger.log('digest_sent', { userId, itemCount: items.length });
  }
}
