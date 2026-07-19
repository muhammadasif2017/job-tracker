import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';

// Unique email per run so tests are safe to run against the dev DB
const EMAIL = `e2e-${Date.now()}@test.dev`;
const PASSWORD = 'E2ePass123!';

describe('Job Tracker (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  // Agent persists the httpOnly refresh cookie across requests, same as a browser.
  let agent: ReturnType<typeof request.agent>;
  let accessToken: string;
  let jobId: string;
  let roundId: string;

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
    app.useGlobalGuards(new JwtAuthGuard(app.get(Reflector)));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
    agent = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
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
  });

  // ── Interview Rounds ────────────────────────────────────────────────────────

  describe('POST /jobs/:jobId/interview-rounds', () => {
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

    it('returns 404 for a round that does not belong to the job', () =>
      agent
        .patch(`/jobs/${jobId}/interview-rounds/nonexistent-id`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ outcome: 'PASSED' })
        .expect(404));
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

  describe('POST /auth/logout', () => {
    it('clears the refresh token', () =>
      agent
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200));
  });
});
