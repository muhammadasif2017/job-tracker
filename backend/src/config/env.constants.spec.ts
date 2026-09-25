import { ENV_VALIDATION_SCHEMA } from './env.constants.js';

const REQUIRED = {
  DATABASE_URL: 'postgresql://localhost:5432/job_tracker',
  JWT_SECRET: 'x'.repeat(32),
  JWT_REFRESH_SECRET: 'y'.repeat(32),
};

describe('ENV_VALIDATION_SCHEMA', () => {
  it('accepts the required variables alone and fills in the defaults', () => {
    const { error, value } = ENV_VALIDATION_SCHEMA.validate(REQUIRED);

    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3001,
      REDIS_URL: 'redis://localhost:6379',
      STORAGE_DRIVER: 'local',
    });
  });

  it('rejects a missing DATABASE_URL', () => {
    const { DATABASE_URL: _omitted, ...rest } = REQUIRED;

    expect(ENV_VALIDATION_SCHEMA.validate(rest).error?.message).toMatch(
      /DATABASE_URL/,
    );
  });

  it('rejects a JWT secret shorter than 32 characters', () => {
    const { error } = ENV_VALIDATION_SCHEMA.validate({
      ...REQUIRED,
      JWT_SECRET: 'short',
    });

    expect(error?.message).toMatch(/JWT_SECRET/);
  });

  it('requires the OCI credentials only when STORAGE_DRIVER is oracle', () => {
    const { error } = ENV_VALIDATION_SCHEMA.validate({
      ...REQUIRED,
      STORAGE_DRIVER: 'oracle',
    });

    expect(error?.message).toMatch(/OCI_NAMESPACE/);
  });

  it('accepts a Sentry DSN and rejects a malformed one', () => {
    expect(
      ENV_VALIDATION_SCHEMA.validate({
        ...REQUIRED,
        SENTRY_DSN: 'https://key@o1.ingest.us.sentry.io/2',
      }).error,
    ).toBeUndefined();
    expect(
      ENV_VALIDATION_SCHEMA.validate({ ...REQUIRED, SENTRY_DSN: 'not a url' })
        .error?.message,
    ).toMatch(/SENTRY_DSN/);
  });
});
