import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

/**
 * Everything the app ever sends: one recipient, a subject and an HTML body.
 * There are no attachments and no plain-text alternative.
 */
export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

/**
 * Wraps Resend. With no `RESEND_API_KEY` configured the service still
 * constructs and every send becomes a logged no-op, so the app boots and
 * runs in environments that cannot send mail.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  private readonly resend?: Resend;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.resend = apiKey ? new Resend(apiKey) : undefined;
    this.from =
      this.config.get<string>('EMAIL_FROM') ?? 'onboarding@resend.dev';
  }

  /**
   * Sends one email, throwing on failure so the calling BullMQ job retries.
   * Returns quietly when no API key is configured — that is a deliberate
   * no-op, not a failure.
   */
  async send({ to, subject, html }: SendEmailInput): Promise<void> {
    if (!this.resend) {
      this.logger.warn({ to, subject }, 'email_send_skipped_no_api_key');
      return;
    }
    // The Resend SDK doesn't throw on an API-level failure — it resolves
    // with { data: null, error }. Surface it as a thrown error so the caller
    // (and the BullMQ job) sees a real failure instead of a false success.
    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject,
      html,
    });
    if (error) {
      // Resend's error is a plain object, so pino would type it 'Object';
      // its `name` (e.g. 'validation_error') is the useful classification.
      this.logger.warn(
        { to, subject, err: error, errorName: error.name },
        'email_send_failed',
      );
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }
}
