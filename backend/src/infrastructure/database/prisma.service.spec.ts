import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from './prisma.service.js';
import { DB_POOL_OPTIONS } from './database.constants.js';

jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({
    provider: 'postgres',
    adapterName: '@prisma/adapter-pg',
  })),
}));

// A unit test cannot show that a connection is still warm when `/health`
// runs, or how long a Neon resume takes. It pins the wiring: the pool gets
// the settings that keep connections and bound connect time, and boot runs
// a query. Timing was checked on the VM after deploy.
describe('PrismaService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('gives the pool a connect timeout and keeps idle connections open', () => {
    new PrismaService();

    expect(PrismaPg).toHaveBeenCalledWith(
      expect.objectContaining(DB_POOL_OPTIONS),
    );
  });

  it('runs one query at boot, so the first request does not open the first connection', async () => {
    const service = new PrismaService();
    const query = jest
      .spyOn(service, '$queryRaw')
      .mockResolvedValue([{ '?column?': 1 }] as never);

    await service.onModuleInit();

    expect(query).toHaveBeenCalledTimes(1);
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
