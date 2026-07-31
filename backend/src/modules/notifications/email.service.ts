import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { Logger } from 'nestjs-pino';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class EmailService {
  private readonly resend?: Resend;
  private readonly from: string;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.resend = apiKey ? new Resend(apiKey) : undefined;
    this.from =
      this.config.get<string>('EMAIL_FROM') ?? 'onboarding@resend.dev';
  }

  async send({ to, subject, html }: SendEmailInput): Promise<void> {
    if (!this.resend) {
      this.logger.warn('email_send_skipped_no_api_key', { to, subject });
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
      this.logger.warn('email_send_failed', { to, subject, error });
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }
}
