import { Test } from '@nestjs/testing';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { CompaniesImportService } from './companies-import.service.js';

const mockCompaniesService = {};
const mockCompaniesImport = { import: jest.fn() };

describe('CompaniesController', () => {
  let controller: CompaniesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [CompaniesController],
      providers: [
        { provide: CompaniesService, useValue: mockCompaniesService },
        { provide: CompaniesImportService, useValue: mockCompaniesImport },
      ],
    }).compile();
    controller = module.get(CompaniesController);
  });

  describe('importCsv', () => {
    // Excel/Google Sheets CSV exports commonly prepend a UTF-8 BOM
    // (EF BB BF / U+FEFF), which would otherwise land inside the first
    // header cell, failing header validation on a valid file. Built via
    // escape sequence, not a literal character, per no-irregular-whitespace.
    it('strips a leading UTF-8 BOM before handing the content to the import service', async () => {
      const bomPrefixed =
        String.fromCharCode(0xfeff) +
        'name,city,businessMode\nAcme,LAHORE,SERVICES';
      const file = {
        buffer: Buffer.from(bomPrefixed, 'utf-8'),
      } as Express.Multer.File;

      await controller.importCsv({ id: 'user-1' }, file);

      expect(mockCompaniesImport.import).toHaveBeenCalledWith(
        'user-1',
        'name,city,businessMode\nAcme,LAHORE,SERVICES',
      );
    });

    it('leaves BOM-free content unchanged', async () => {
      const file = {
        buffer: Buffer.from(
          'name,city,businessMode\nAcme,LAHORE,SERVICES',
          'utf-8',
        ),
      } as Express.Multer.File;

      await controller.importCsv({ id: 'user-1' }, file);

      expect(mockCompaniesImport.import).toHaveBeenCalledWith(
        'user-1',
        'name,city,businessMode\nAcme,LAHORE,SERVICES',
      );
    });
  });
});
