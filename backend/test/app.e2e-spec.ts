import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { GlobalExceptionFilter } from '../src/common/filters/prisma-exception.filter';

// Unique email per run so tests are safe to run against the dev DB
const EMAIL = `e2e-${Date.now()}@test.dev`;
const PASSWORD = 'E2ePass123!';

describe('Job Tracker (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accessToken: string;
  let refreshToken: string;
  let jobId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
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
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await app.close();
  });

  // ── Auth ────────────────────────────────────────────────────────────────────

  describe('POST /auth/register', () => {
    it('creates a new user and returns tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: EMAIL, password: PASSWORD, name: 'E2E Tester' })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
      // Verify /auth/me returns the authenticated user
      const me = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(me.body.email).toBe(EMAIL);
    });

    it('rejects duplicate email with 400', () =>
      request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: EMAIL, password: PASSWORD, name: 'Dup' })
        .expect(400));
  });

  describe('POST /auth/login', () => {
    it('returns tokens for valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
    });

    it('rejects wrong password with 401', () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: EMAIL, password: 'wrong' })
        .expect(401));
  });

  describe('GET /auth/me', () => {
    it('returns current user', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.email).toBe(EMAIL);
    });

    it('returns 401 without token', () =>
      request(app.getHttpServer()).get('/auth/me').expect(401));
  });

  describe('POST /auth/refresh', () => {
    it('issues new token pair', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
    });
  });

  // ── Jobs ────────────────────────────────────────────────────────────────────

  describe('POST /jobs', () => {
    it('creates a job and CREATED timeline event', async () => {
      const res = await request(app.getHttpServer())
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
      request(app.getHttpServer())
        .post('/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ company: '', position: 'Dev' })
        .expect(400));

    it('returns 401 without token', () =>
      request(app.getHttpServer())
        .post('/jobs')
        .send({ company: 'X', position: 'Y' })
        .expect(401));
  });

  describe('GET /jobs', () => {
    it('returns paginated job list', async () => {
      const res = await request(app.getHttpServer())
        .get('/jobs')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.meta).toHaveProperty('total');
      expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    });

    it('filters by status', async () => {
      const res = await request(app.getHttpServer())
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
      const res = await request(app.getHttpServer())
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
      const res = await request(app.getHttpServer())
        .get(`/jobs/${jobId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(jobId);
    });

    it('returns 404 for non-existent id', () =>
      request(app.getHttpServer())
        .get('/jobs/nonexistent-id')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404));
  });

  describe('PATCH /jobs/:id', () => {
    it('updates status and creates STATUS_CHANGE event', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/jobs/${jobId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'INTERVIEWING', nextInterviewAt: '2026-07-15' })
        .expect(200);

      expect(res.body.status).toBe('INTERVIEWING');
      expect(res.body.nextInterviewAt).toBeTruthy();
    });
  });

  describe('GET /jobs/:id/events', () => {
    it('returns timeline with CREATED and STATUS_CHANGE events', async () => {
      const res = await request(app.getHttpServer())
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

  describe('GET /jobs/export', () => {
    it('returns CSV with correct headers', async () => {
      const res = await request(app.getHttpServer())
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
      request(app.getHttpServer())
        .delete(`/jobs/${jobId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200));

    it('returns 404 after deletion', () =>
      request(app.getHttpServer())
        .get(`/jobs/${jobId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404));
  });

  describe('POST /auth/logout', () => {
    it('clears the refresh token', () =>
      request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200));
  });
});
