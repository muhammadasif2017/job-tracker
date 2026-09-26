import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from './prisma.service.js';

jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({
    provider: 'postgres',
    adapterName: '@prisma/adapter-pg',
  })),
}));

// A unit test cannot show how long the first query takes or that /health is
// fast after a deploy; that is checked on the VM. This pins the wiring: the
// adapter gets DATABASE_URL, and boot runs exactly one lightweight query.
describe('PrismaService', () => {
  const savedUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DATABASE_URL = 'postgresql://localhost:5432/job_tracker';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.DATABASE_URL = savedUrl;
  });

  it('builds the pg adapter from DATABASE_URL', () => {
    new PrismaService();

    expect(PrismaPg).toHaveBeenCalledWith({
      connectionString: 'postgresql://localhost:5432/job_tracker',
    });
  });

  it('runs SELECT 1 at boot, so the first request does not pay for the first query', async () => {
    const service = new PrismaService();
    const query = jest
      .spyOn(service, '$queryRaw')
      .mockResolvedValue([{ '?column?': 1 }] as never);

    await service.onModuleInit();

    expect(query).toHaveBeenCalledTimes(1);
    // A tagged template: the first argument holds the literal SQL parts.
    const [strings] = query.mock.calls[0] as unknown as [TemplateStringsArray];
    expect(strings.join('')).toBe('SELECT 1');
  });

  it('fails boot when the database cannot answer', async () => {
    const service = new PrismaService();
    jest
      .spyOn(service, '$queryRaw')
      .mockRejectedValue(new Error("Can't reach database server"));

    await expect(service.onModuleInit()).rejects.toThrow(
      "Can't reach database server",
    );
  });
});
