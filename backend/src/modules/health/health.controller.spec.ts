import { Test } from '@nestjs/testing';
import { HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { RedisHealthIndicator } from './redis.health.js';
import { PrismaService } from '../../prisma/prisma.service.js';

// Runs every indicator the controller registers, so the arguments it passes
// to each are observable — the real HealthCheckService is what would
// otherwise invoke them.
const mockHealth = {
  check: jest.fn(async (indicators: (() => Promise<unknown>)[]) => {
    for (const indicator of indicators) await indicator();
    return { status: 'ok' };
  }),
};
const mockDb = { pingCheck: jest.fn().mockResolvedValue({}) };
const mockRedis = { isHealthy: jest.fn().mockResolvedValue({}) };
const mockPrisma = {};

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: mockHealth },
        { provide: PrismaHealthIndicator, useValue: mockDb },
        { provide: RedisHealthIndicator, useValue: mockRedis },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    controller = module.get(HealthController);
  });

  it('checks both the database and Redis', async () => {
    await controller.check();

    expect(mockDb.pingCheck).toHaveBeenCalledWith(
      'database',
      mockPrisma,
      expect.anything(),
    );
    expect(mockRedis.isHealthy).toHaveBeenCalledWith('redis');
  });

  // Terminus' default is 1000ms, which is under Neon's idle-resume time —
  // leaving it unset made the first probe after a quiet period report the
  // database as down when it was merely waking up.
  it('gives the database ping longer than the Terminus default so a Neon cold start is not reported as down', async () => {
    await controller.check();

    const options = mockDb.pingCheck.mock.calls[0][2] as { timeout: number };
    expect(options.timeout).toBeGreaterThan(1000);
    expect(options.timeout).toBe(5000);
  });
});
