import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { PatScopeGuard } from '../src/common/guards/pat-scope.guard';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';

// Unique email per run so tests are safe to run against the dev DB
const EMAIL = `e2e-${Date.now()}@test.dev`;
const ADMIN_TARGET_EMAIL = `e2e-admin-target-${Date.now()}@test.dev`;
const PASSWORD = 'E2ePass123!';

describe('Job Tracker (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  // Agent persists the httpOnly refresh cookie across requests, same as a browser.
  let agent: ReturnType<typeof request.agent>;
  let accessToken: string;
  let userId: string;
  let jobId: string;
  let roundId: string;
  let patToken: string;
  let patTokenId: string;
  let patAccessToken: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalGuards(
      new JwtAuthGuard(app.get(Reflector)),
      new RolesGuard(app.get(Reflector)),
      new PatScopeGuard(app.get(Reflector)),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
    agent = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [EMAIL, ADMIN_TARGET_EMAIL] } },
    });
    await app.close();
  });

  // ── Auth ────────────────────────────────────────────────────────────────────

  describe('POST /auth/register', () => {
    it('creates a new user and returns tokens', async () => {
      const res = await agent
        .post('/auth/register')
        .send({ email: EMAIL, password: PASSWORD, name: 'E2E Tester' })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).not.toHaveProperty('refreshToken');
      expect(res.headers['set-cookie']?.[0]).toMatch(/^jt_refresh=.+HttpOnly/);
      accessToken = res.body.accessToken;
      // Verify /auth/me returns the authenticated user
      const me = await agent
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(me.body.email).toBe(EMAIL);
      userId = me.body.id;
    });

    it('rejects duplicate email with 400', () =>
      agent
        .post('/auth/register')
        .send({ email: EMAIL, password: PASSWORD, name: 'Dup' })
        .expect(400));
  });

  describe('POST /auth/login', () => {
    it('returns tokens for valid credentials', async () => {
      const res = await agent
        .post('/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      accessToken = res.body.accessToken;
    });

    it('rejects wrong password with 401', () =>
      agent
        .post('/auth/login')
        .send({ email: EMAIL, password: 'wrong' })
        .expect(401));
  });

  describe('GET /auth/me', () => {
    it('returns current user', async () => {
      const res = await agent
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.email).toBe(EMAIL);
    });

    it('returns 401 without token', () => agent.get('/auth/me').expect(401));
  });

  describe('POST /auth/refresh', () => {
    it('issues a new access token using the refresh cookie', async () => {
      // No body needed — the agent resends the httpOnly cookie set at login.
      const res = await agent.post('/auth/refresh').expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).not.toHaveProperty('refreshToken');
      accessToken = res.body.accessToken;
    });

    it('rejects a request with no refresh cookie', () =>
      request(app.getHttpServer()).post('/auth/refresh').expect(401));
  });

  // ── Personal access tokens ──────────────────────────────────────────────────

  describe('POST /tokens', () => {
    it('creates a token and returns the raw value exactly once', async () => {
      const res = await agent
        .post('/tokens')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'e2e extension' })
        .expect(201);

      expect(res.body.token).toMatch(/^jt_pat_/);
      expect(res.body).not.toHaveProperty('tokenHash');
      patToken = res.body.token;
      patTokenId = res.body.id;
    });

    it('returns 401 without token', () =>
      agent.post('/tokens').send({ name: 'x' }).expect(401));
  });

  describe('GET /tokens', () => {
    it('lists the created token without leaking its hash', async () => {
      const res = await agent
        .get('/tokens')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const listed = res.body.find((t: { id: string }) => t.id === patTokenId);
      expect(listed).toMatchObject({ id: patTokenId, name: 'e2e extension' });
      expect(listed).not.toHaveProperty('tokenHash');
      expect(listed).not.toHaveProperty('token');
    });
  });

  describe('POST /auth/token/exchange', () => {
    it('exchanges the PAT for a short-lived, scope-restricted access token', async () => {
      const res = await agent
        .post('/auth/token/exchange')
        .send({ token: patToken })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('expiresIn');
      patAccessToken = res.body.accessToken;
    });

    it('rejects a malformed token with 403', () =>
      agent
        .post('/auth/token/exchange')
        .send({ token: 'not-a-real-token' })
        .expect(403));

    it('allows the PAT-derived token to hit an @PatAccessible() route', () =>
      agent
        .post('/jobs')
        .set('Authorization', `Bearer ${patAccessToken}`)
        .send({ company: 'Extension Co', position: 'Imported Role' })
        .expect(201));

    it('rejects the PAT-derived token on a route without @PatAccessible()', () =>
      agent
        .get('/auth/me')
        .set('Authorization', `Bearer ${patAccessToken}`)
        .expect(403));
  });

  describe('DELETE /tokens/:id', () => {
    it('revokes the token', () =>
      agent
        .delete(`/tokens/${patTokenId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200));

    it('returns 404 revoking an already-revoked token', () =>
      agent
        .delete(`/tokens/${patTokenId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404));

    it('rejects exchanging the now-revoked PAT with 403', () =>
      agent
        .post('/auth/token/exchange')
        .send({ token: patToken })
        .expect(403));

    it('rejects the already-issued access token derived from the now-revoked PAT', () =>
      agent
        .post('/jobs')
        .set('Authorization', `Bearer ${patAccessToken}`)
        .send({ company: 'Should Fail Co', position: 'Should Not Be Created' })
        .expect(401));
  });

  // ── Jobs ────────────────────────────────────────────────────────────────────

  describe('POST /jobs', () => {
    it('creates a job and CREATED timeline event', async () => {
      const res = await agent
        .post('/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          company: 'Stripe',
          position: 'Senior Engineer',
          status: 'APPLIED',
        })
        .expect(201);

      expect(res.body.company).toBe('Stripe');
      jobId = res.body.id;
    });

    it('rejects empty company with 400', () =>
      agent
        .post('/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ company: '', position: 'Dev' })
        .expect(400));

    it('returns 401 without token', () =>
      agent.post('/jobs').send({ company: 'X', position: 'Y' }).expect(401));
  });

  describe('POST /jobs/parse', () => {
    it('rejects a request with neither url nor text with 400', () =>
      agent
        .post('/jobs/parse')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(400));

    it('returns 401 without token', () =>
      agent.post('/jobs/parse').send({ text: 'Senior Engineer' }).expect(401));
  });

  describe('GET /jobs', () => {
    it('returns paginated job list', async () => {
      const res = await agent
        .get('/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.meta).toHaveProperty('total');
      expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    });

    it('filters by status', async () => {
      const res = await agent
        .get('/jobs?status=APPLIED')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.data.every((j: any) => j.status === 'APPLIED')).toBe(
        true,
      );
    });
  });

  describe('GET /jobs/stats', () => {
    it('returns stats with byStatus breakdown', async () => {
      const res = await agent
        .get('/jobs/stats')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('byStatus');
      expect(res.body).toHaveProperty('responseRate');
    });
  });

  describe('GET /jobs/attention', () => {
    it('returns needs-attention items as an array', async () => {
      const res = await agent
        .get('/jobs/attention')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toBeInstanceOf(Array);
    });

    it('returns 401 without token', () =>
      agent.get('/jobs/attention').expect(401));
  });

  describe('GET /jobs/:id', () => {
    it('returns the job', async () => {
      const res = await agent
        .get(`/jobs/${jobId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(jobId);
    });

    it('returns 404 for non-existent id', () =>
      agent
        .get('/jobs/nonexistent-id')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404));
  });

  describe('PATCH /jobs/:id', () => {
    it('updates status and creates STATUS_CHANGE event', async () => {
      const res = await agent
        .patch(`/jobs/${jobId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'INTERVIEWING' })
        .expect(200);

      expect(res.body.status).toBe('INTERVIEWING');
    });

    it('409s one of two simultaneous status changes and records exactly one STATUS_CHANGE event', async () => {
      const created = await agent
        .post('/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ company: 'Race Co', position: 'Engineer', status: 'APPLIED' })
        .expect(201);
      const raceJobId = created.body.id;

      // Two requests fired together, both reading status: APPLIED and racing
      // to CAS it to a different target. Real concurrency against real
      // Postgres — this is what a mocked $transaction can't prove (see
      // ADR-018).
      const [a, b] = await Promise.all([
        agent
          .patch(`/jobs/${raceJobId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ status: 'INTERVIEWING' }),
        agent
          .patch(`/jobs/${raceJobId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ status: 'OFFER' }),
      ]);

      const statuses = [a.status, b.status].sort((x, y) => x - y);
      expect(statuses).toEqual([200, 409]);

      const winner = a.status === 200 ? a : b;
      const loser = a.status === 200 ? b : a;
      expect(loser.body.message).toMatch(/changed concurrently/i);

      const finalJob = await agent
        .get(`/jobs/${raceJobId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(finalJob.body.status).toBe(winner.body.status);

      // The loser's CAS must not have written an event for its own attempt —
      // exactly one STATUS_CHANGE for this job, matching the winner.
      const events = await agent
        .get(`/jobs/${raceJobId}/events`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const statusChangeEvents = events.body.filter(
        (e: { type: string }) => e.type === 'STATUS_CHANGE',
      );
      expect(statusChangeEvents).toHaveLength(1);
      expect(statusChangeEvents[0].fromStatus).toBe('APPLIED');
      expect(statusChangeEvents[0].toStatus).toBe(winner.body.status);
    });
  });

  describe('GET /jobs/:id/events', () => {
    it('returns timeline with CREATED and STATUS_CHANGE events', async () => {
      const res = await agent
        .get(`/jobs/${jobId}/events`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toBeInstanceOf(Array);
      expect(res.body.length).toBe(2);
      expect(res.body[0].type).toBe('CREATED');
      expect(res.body[1].type).toBe('STATUS_CHANGE');
      expect(res.body[1].fromStatus).toBe('APPLIED');
      expect(res.body[1].toStatus).toBe('INTERVIEWING');
    });

    it('rejects page=0 with 400 instead of a raw 500', () =>
      agent
        .get(`/jobs/${jobId}/events?page=0`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400));

    it('rejects limit=500 with 400 (exceeds the max)', () =>
      agent
        .get(`/jobs/${jobId}/events?limit=500`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400));
  });

  // ── Interview Rounds ────────────────────────────────────────────────────────

  describe('POST /jobs/:jobId/interview-rounds', () => {
    it('promotes an APPLIED job to INTERVIEWING with a STATUS_CHANGE event', async () => {
      const created = await agent
        .post('/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          company: 'Promotion Co',
          position: 'Engineer',
          status: 'APPLIED',
        })
        .expect(201);
      const promoJobId = created.body.id;

      await agent
        .post(`/jobs/${promoJobId}/interview-rounds`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stage: 'Phone Screen', scheduledAt: '2026-08-01' })
        .expect(201);

      const job = await agent
        .get(`/jobs/${promoJobId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(job.body.status).toBe('INTERVIEWING');

      const events = await agent
        .get(`/jobs/${promoJobId}/events`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(events.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'STATUS_CHANGE',
            fromStatus: 'APPLIED',
            toStatus: 'INTERVIEWING',
          }),
        ]),
      );

      await agent
        .post(`/jobs/${promoJobId}/interview-rounds`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stage: 'Technical Round', scheduledAt: '2026-08-10' })
        .expect(201);

      const eventsAfterSecondRound = await agent
        .get(`/jobs/${promoJobId}/events`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(eventsAfterSecondRound.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'INTERVIEW_ROUND_ADDED',
            toStatus: 'INTERVIEWING',
            note: 'Technical Round',
          }),
        ]),
      );
    });

    it('creates a round and recomputes nextInterviewAt', async () => {
      const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      const res = await agent
        .post(`/jobs/${jobId}/interview-rounds`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stage: 'Phone Screen', scheduledAt: future })
        .expect(201);

      expect(res.body.stage).toBe('Phone Screen');
      expect(res.body.outcome).toBe('PENDING');
      roundId = res.body.id;

      const job = await agent
        .get(`/jobs/${jobId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(job.body.nextInterviewAt?.split('T')[0]).toBe(future);
    });

    it('rejects a scheduledAt more than 2 years in the future with 400', () =>
      agent
        .post(`/jobs/${jobId}/interview-rounds`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stage: 'Onsite', scheduledAt: '2099-01-01' })
        .expect(400));

    it('rejects a scheduledAt more than 2 years in the past with 400', () =>
      agent
        .post(`/jobs/${jobId}/interview-rounds`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stage: 'Onsite', scheduledAt: '2001-01-01' })
        .expect(400));

    it('returns 404 for a non-existent job', () =>
      agent
        .post('/jobs/nonexistent-id/interview-rounds')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ stage: 'Phone Screen', scheduledAt: '2026-08-01' })
        .expect(404));
  });

  describe('GET /jobs/:jobId/interview-rounds', () => {
    it('lists rounds ordered by scheduledAt', async () => {
      const res = await agent
        .get(`/jobs/${jobId}/interview-rounds`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toBeInstanceOf(Array);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(roundId);
    });
  });

  describe('PATCH /jobs/:jobId/interview-rounds/:roundId', () => {
    it('updates outcome and recomputes nextInterviewAt to null when none remain pending', async () => {
      const res = await agent
        .patch(`/jobs/${jobId}/interview-rounds/${roundId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ outcome: 'FAILED' })
        .expect(200);
      expect(res.body.outcome).toBe('FAILED');

      const job = await agent
        .get(`/jobs/${jobId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(job.body.nextInterviewAt).toBeNull();
    });

    it('rejects a scheduledAt more than 2 years out on PATCH too (PartialType carries the bound)', () =>
      agent
        .patch(`/jobs/${jobId}/interview-rounds/${roundId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ scheduledAt: '2099-01-01' })
        .expect(400));

    it('returns 404 for a round that does not belong to the job', () =>
      agent
        .patch(`/jobs/${jobId}/interview-rounds/nonexistent-id`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ outcome: 'PASSED' })
        .expect(404));

    it('clears reminderSentAt when the round is rescheduled', async () => {
      await prisma.interviewRound.update({
        where: { id: roundId },
        data: { reminderSentAt: new Date() },
      });

      await agent
        .patch(`/jobs/${jobId}/interview-rounds/${roundId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ scheduledAt: '2027-01-15T10:00:00.000Z' })
        .expect(200);

      const round = await prisma.interviewRound.findUniqueOrThrow({
        where: { id: roundId },
      });
      expect(round.reminderSentAt).toBeNull();
    });

    it('clears reminderSentAt when a cancelled round is reverted to pending', async () => {
      await prisma.interviewRound.update({
        where: { id: roundId },
        data: { outcome: 'CANCELLED', reminderSentAt: new Date() },
      });

      await agent
        .patch(`/jobs/${jobId}/interview-rounds/${roundId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ outcome: 'PENDING' })
        .expect(200);

      const round = await prisma.interviewRound.findUniqueOrThrow({
        where: { id: roundId },
      });
      expect(round.reminderSentAt).toBeNull();
    });
  });

  describe('DELETE /jobs/:jobId/interview-rounds/:roundId', () => {
    it('deletes the round', () =>
      agent
        .delete(`/jobs/${jobId}/interview-rounds/${roundId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200));

    it('returns 404 for an already-deleted round', () =>
      agent
        .delete(`/jobs/${jobId}/interview-rounds/${roundId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404));
  });

  describe('GET /jobs/export', () => {
    it('returns CSV with correct headers', async () => {
      const res = await agent
        .get('/jobs/export')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.text).toContain('Company,Position,Status');
      expect(res.text).toContain('Stripe');
    });
  });

  describe('PATCH /users/me/notifications', () => {
    it('updates and round-trips notification preferences', async () => {
      const res = await agent
        .patch('/users/me/notifications')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ interviewRemindersEnabled: false, digestFrequency: 'WEEKLY' })
        .expect(200);

      expect(res.body.interviewRemindersEnabled).toBe(false);
      expect(res.body.digestFrequency).toBe('WEEKLY');

      const profile = await agent
        .get('/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(profile.body.interviewRemindersEnabled).toBe(false);
      expect(profile.body.digestFrequency).toBe('WEEKLY');
    });

    it('rejects an invalid digestFrequency with 400', () =>
      agent
        .patch('/users/me/notifications')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ digestFrequency: 'HOURLY' })
        .expect(400));

    it('updates and round-trips timezone', async () => {
      const res = await agent
        .patch('/users/me/notifications')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ timezone: 'Asia/Karachi' })
        .expect(200);

      expect(res.body.timezone).toBe('Asia/Karachi');

      const profile = await agent
        .get('/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(profile.body.timezone).toBe('Asia/Karachi');
    });

    // 'UTC' is the User.timezone column default but Intl.supportedValuesOf
    // doesn't list it (legacy alias, not a canonical IANA zone name) — the
    // validator must special-case it back in, or the DB default itself would
    // fail validation on any round-trip through this endpoint.
    it('accepts UTC even though Intl.supportedValuesOf omits it', () =>
      agent
        .patch('/users/me/notifications')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ timezone: 'UTC' })
        .expect(200));

    it('rejects a non-IANA timezone string with 400', () =>
      agent
        .patch('/users/me/notifications')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ timezone: 'Not/A_Real_Zone' })
        .expect(400));

    it('returns 401 without token', () =>
      agent
        .patch('/users/me/notifications')
        .send({ digestFrequency: 'DAILY' })
        .expect(401));
  });

  describe('DELETE /jobs/:id', () => {
    it('deletes the job', () =>
      agent
        .delete(`/jobs/${jobId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200));

    it('returns 404 after deletion', () =>
      agent
        .get(`/jobs/${jobId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404));
  });

  describe('GET /admin/users', () => {
    it('returns 403 for a non-admin user', () =>
      agent
        .get('/admin/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403));

    it('returns the user list once promoted to ADMIN', async () => {
      await prisma.user.update({
        where: { id: userId },
        data: { role: 'ADMIN' },
      });

      const res = await agent
        .get('/admin/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.meta).toHaveProperty('total');
      expect(
        res.body.data.some((u: { email: string }) => u.email === EMAIL),
      ).toBe(true);
    });

    it('rejects deleting your own account with 403', () =>
      agent
        .delete(`/admin/users/${userId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403));

    it('deletes another user', async () => {
      const target = await prisma.user.create({
        data: {
          email: ADMIN_TARGET_EMAIL,
          name: 'Admin Target',
          password: 'unused',
        },
      });

      await agent
        .delete(`/admin/users/${target.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const found = await prisma.user.findUnique({ where: { id: target.id } });
      expect(found).toBeNull();
    });
  });

  describe('POST /auth/logout', () => {
    it('clears the refresh token', () =>
      agent
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200));
  });
});
