import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CompaniesImportService } from './companies-import.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const mockPrisma = {
  company: {
    findMany: jest.fn(),
    createMany: jest.fn(),
  },
};

describe('CompaniesImportService', () => {
  let service: CompaniesImportService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.company.findMany.mockResolvedValue([]);
    mockPrisma.company.createMany.mockResolvedValue({ count: 0 });
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
