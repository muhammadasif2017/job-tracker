import { PrismaService } from './prisma.service.js';

describe('PrismaService', () => {
  it('runs one query at boot so the first request does not pay for the first connection', async () => {
    const service = new PrismaService();
    const connect = jest
      .spyOn(service, '$connect')
      .mockResolvedValue(undefined);
    const query = jest
      .spyOn(service, '$queryRaw')
      .mockResolvedValue([{ '?column?': 1 }] as never);

    await service.onModuleInit();

    expect(connect).toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('fails boot when the database cannot answer', async () => {
    const service = new PrismaService();
    jest.spyOn(service, '$connect').mockResolvedValue(undefined);
    jest
      .spyOn(service, '$queryRaw')
      .mockRejectedValue(new Error("Can't reach database server"));

    await expect(service.onModuleInit()).rejects.toThrow(
      "Can't reach database server",
    );
  });
});
