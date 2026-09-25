import * as Joi from 'joi';

/** Required only when `STORAGE_DRIVER=oracle`; optional for local storage. */
const ociRequired = Joi.when('STORAGE_DRIVER', {
  is: 'oracle',
  then: Joi.string().required(),
  otherwise: Joi.string().optional(),
});

/**
 * The environment `ConfigModule` validates at boot, so a missing required
 * variable stops startup instead of failing the first request that needs it.
 * Defaults here are what `ConfigService.get` returns when a variable is
 * unset. The table in `backend/CLAUDE.md` documents each one.
 */
export const ENV_VALIDATION_SCHEMA = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  DATABASE_URL: Joi.string().required(),
  PORT: Joi.number().default(3001),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  FRONTEND_URL: Joi.string().default('http://localhost:3000'),
  REDIS_URL: Joi.string().default('redis://localhost:6379'),
  GROQ_API_KEY: Joi.string().optional(),
  TAVILY_API_KEY: Joi.string().optional(),
  GOOGLE_CLIENT_ID: Joi.string().optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().optional(),
  GITHUB_CLIENT_ID: Joi.string().optional(),
  GITHUB_CLIENT_SECRET: Joi.string().optional(),
  RESEND_API_KEY: Joi.string().optional(),
  EMAIL_FROM: Joi.string().default('onboarding@resend.dev'),
  STORAGE_DRIVER: Joi.string().valid('local', 'oracle').default('local'),
  OCI_NAMESPACE: ociRequired,
  OCI_REGION: ociRequired,
  OCI_BUCKET_NAME: ociRequired,
  OCI_ACCESS_KEY_ID: ociRequired,
  OCI_SECRET_ACCESS_KEY: ociRequired,
  // Sentry (ADR-050). Unset or empty means error tracking is off.
  // src/instrument.ts reads these from process.env before ConfigModule
  // exists; they are listed here so a malformed DSN still stops boot. Empty
  // must pass: docker-compose.prod.yml passes `${SENTRY_DSN:-}`, and an image
  // built without the GIT_SHA build arg has `SENTRY_RELEASE=""`.
  SENTRY_DSN: Joi.string().uri().allow('').optional(),
  SENTRY_ENVIRONMENT: Joi.string().allow('').optional(),
  SENTRY_RELEASE: Joi.string().allow('').optional(),
  // Port for the Prometheus listener (ADR-052). Empty means off, for the same
  // reason as the Sentry values: compose passes `${METRICS_PORT:-}`.
  METRICS_PORT: Joi.number().port().allow('').optional(),
});
