import { Processor, WorkerHost } from '@nestjs/bullmq';
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
              select: { id: true, email: true, interviewRemindersEnabled: true },
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
    if (!user.interviewRemindersEnabled) return;

    const { subject, html } = interviewReminderEmail({
      company: round.job.company,
      position: round.job.position,
      stage: round.stage,
      scheduledAt: round.scheduledAt,
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

    const items = await getAttentionItems(this.prisma, userId);
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
    this.logger.log('digest_sent', { userId, itemCount: items.length });
  }
}
