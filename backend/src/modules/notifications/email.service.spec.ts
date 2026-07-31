import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { EmailService } from './email.service.js';

const sendMock = jest.fn().mockResolvedValue({ data: { id: 'x' } });

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}));

describe('EmailService', () => {
  const logger = { warn: jest.fn(), log: jest.fn() } as unknown as Logger;

  afterEach(() => jest.clearAllMocks());

  function build(config: Record<string, string | undefined>) {
    const configService = {
      get: (key: string) => config[key],
    } as unknown as ConfigService;
    return new EmailService(configService, logger);
  }

  it('skips sending and logs a warning when RESEND_API_KEY is not set', async () => {
    const service = build({});
    await service.send({ to: 'a@b.com', subject: 'Hi', html: '<p>hi</p>' });

    expect(sendMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'email_send_skipped_no_api_key',
      expect.objectContaining({ to: 'a@b.com' }),
    );
  });

  it('sends via Resend when an API key is configured', async () => {
    const service = build({
      RESEND_API_KEY: 're_test',
      EMAIL_FROM: 'me@x.com',
    });
    await service.send({ to: 'a@b.com', subject: 'Hi', html: '<p>hi</p>' });

    expect(sendMock).toHaveBeenCalledWith({
      from: 'me@x.com',
      to: 'a@b.com',
      subject: 'Hi',
      html: '<p>hi</p>',
    });
  });

  it('defaults EMAIL_FROM to onboarding@resend.dev', async () => {
    const service = build({ RESEND_API_KEY: 're_test' });
    await service.send({ to: 'a@b.com', subject: 'Hi', html: '<p>hi</p>' });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'onboarding@resend.dev' }),
    );
  });
});
