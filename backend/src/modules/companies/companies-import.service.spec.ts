import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { CompaniesImportService } from './companies-import.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const mockPrisma = {
  company: {
    findMany: jest.fn(),
    createMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('CompaniesImportService', () => {
  let service: CompaniesImportService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.company.findMany.mockResolvedValue([]);
    mockPrisma.company.createMany.mockImplementation(
      ({ data }: { data: unknown[] }) =>
        Promise.resolve({ count: data.length }),
    );
    // Mirrors companies.service.spec.ts's $transaction mock — runs the
    // callback against mockPrisma itself, so `tx.company.*` inside the
    // service hits the same jest.fn()s as `this.prisma.company.*` would.
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    const module = await Test.createTestingModule({
      providers: [
        CompaniesImportService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(CompaniesImportService);
  });

  it('throws BadRequestException on an empty file', async () => {
    await expect(service.import('user-1', '')).rejects.toThrow(
      BadRequestException,
    );
    expect(mockPrisma.company.createMany).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when there are no data rows', async () => {
    await expect(
      service.import('user-1', 'name,city,businessMode\n'),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException on a wrong header', async () => {
    await expect(
      service.import('user-1', 'company,location\nAcme,Lahore'),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when the file exceeds the max row count', async () => {
    const rows = Array.from(
      { length: 1001 },
      (_, i) => `Co ${i},LAHORE,SERVICES`,
    ).join('\n');
    const csv = `name,city,businessMode\n${rows}`;

    await expect(service.import('user-1', csv)).rejects.toThrow(
      BadRequestException,
    );
    expect(mockPrisma.company.createMany).not.toHaveBeenCalled();
  });

  it('reports a row with the wrong number of columns without aborting the import', async () => {
    const csv =
      'name,city,businessMode\nGood Co,LAHORE,SERVICES\nBad Row,LAHORE';

    const result = await service.import('user-1', csv);

    expect(result.imported).toBe(1);
    expect(result.errors).toEqual([
      {
        row: 3,
        message: expect.stringContaining('Expected 3 columns'),
      },
    ]);
  });

  it('imports all valid rows and reports zero errors', async () => {
    const csv =
      'name,city,businessMode\n' +
      'Systems Limited,LAHORE,SERVICES\n' +
      'Devsinc,LAHORE,SERVICES\n' +
      'Careem,KARACHI,PRODUCT';

    const result = await service.import('user-1', csv);

    expect(result).toEqual({ imported: 3, errors: [] });
    expect(mockPrisma.company.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'user-1',
          name: 'Systems Limited',
          city: 'LAHORE',
          businessMode: 'SERVICES',
        },
        {
          userId: 'user-1',
          name: 'Devsinc',
          city: 'LAHORE',
          businessMode: 'SERVICES',
        },
        {
          userId: 'user-1',
          name: 'Careem',
          city: 'KARACHI',
          businessMode: 'PRODUCT',
        },
      ],
      skipDuplicates: true,
    });
  });

  it('allows an empty businessMode column', async () => {
    const csv = 'name,city,businessMode\nUnknown Mode Co,ISLAMABAD,';

    const result = await service.import('user-1', csv);

    expect(result.errors).toEqual([]);
    expect(mockPrisma.company.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'user-1',
          name: 'Unknown Mode Co',
          city: 'ISLAMABAD',
          businessMode: undefined,
        },
      ],
      skipDuplicates: true,
    });
  });

  it('reports a malformed row (invalid city) without aborting the whole import', async () => {
    const csv =
      'name,city,businessMode\n' +
      'Good Co,LAHORE,SERVICES\n' +
      'Bad Co,Multan,SERVICES';

    const result = await service.import('user-1', csv);

    expect(result.imported).toBe(1);
    expect(result.errors).toEqual([
      {
        row: 3,
        message: expect.stringContaining('Invalid city "Multan"'),
      },
    ]);
  });

  it('reports a malformed row (invalid businessMode)', async () => {
    const csv = 'name,city,businessMode\nBad Co,LAHORE,CONSULTING';

    const result = await service.import('user-1', csv);

    expect(result.imported).toBe(0);
    expect(result.errors[0].message).toContain('Invalid businessMode');
  });

  it('reports a missing name as a row error', async () => {
    const csv = 'name,city,businessMode\n,LAHORE,SERVICES';

    const result = await service.import('user-1', csv);

    expect(result.errors).toEqual([{ row: 2, message: 'name is required' }]);
  });

  it('rejects a duplicate name against an existing saved company (case-insensitive)', async () => {
    mockPrisma.company.findMany.mockResolvedValue([
      { name: 'Systems Limited' },
    ]);
    const csv = 'name,city,businessMode\nsystems limited,LAHORE,SERVICES';

    const result = await service.import('user-1', csv);

    expect(result.imported).toBe(0);
    expect(result.errors[0].message).toContain('Duplicate company name');
  });

  it('reports the DB-confirmed insert count, not the attempted count, when a row is skipped by the unique constraint', async () => {
    // Simulates a concurrent-import race: app-level dedup (findMany snapshot
    // + seenNames) doesn't see the row, but the DB unique constraint does
    // and createMany's skipDuplicates silently drops it.
    mockPrisma.company.createMany.mockResolvedValue({ count: 1 });
    const csv =
      'name,city,businessMode\nGood Co,LAHORE,SERVICES\nOther Co,LAHORE,SERVICES';

    const result = await service.import('user-1', csv);

    expect(result.imported).toBe(1);
  });

  it('reports a name over the 200-char limit as a row error', async () => {
    const longName = 'A'.repeat(201);
    const csv = `name,city,businessMode\n${longName},LAHORE,SERVICES`;

    const result = await service.import('user-1', csv);

    expect(result.imported).toBe(0);
    expect(result.errors).toEqual([
      {
        row: 2,
        message: expect.stringContaining('200 characters or fewer'),
      },
    ]);
  });

  it('runs the name-check + createMany inside a Serializable transaction', async () => {
    const csv = 'name,city,businessMode\nSystems Limited,LAHORE,SERVICES';

    await service.import('user-1', csv);

    expect(mockPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('maps a P2034 serialization failure (concurrent import/create race) to ConflictException', async () => {
    mockPrisma.$transaction.mockRejectedValue({ code: 'P2034' });
    const csv = 'name,city,businessMode\nSystems Limited,LAHORE,SERVICES';

    await expect(service.import('user-1', csv)).rejects.toThrow(
      ConflictException,
    );
  });

  it('rejects a duplicate name repeated within the same file', async () => {
    const csv =
      'name,city,businessMode\n' +
      'Systems Limited,LAHORE,SERVICES\n' +
      'Systems Limited,LAHORE,SERVICES';

    const result = await service.import('user-1', csv);

    expect(result.imported).toBe(1);
    expect(result.errors).toEqual([
      { row: 3, message: expect.stringContaining('Duplicate company name') },
    ]);
  });
});
