import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { CompaniesImportService } from './companies-import.service.js';

// Exercises the real HTTP pipeline (FileInterceptor's multer limits), same
// rationale as resumes.upload-limits.spec.ts — a controller-level test
// calling importCsv() directly would bypass multer's fileSize limit
// entirely and never prove what status code an oversized upload actually
// gets back.
describe('CompaniesController CSV import size limit (HTTP pipeline)', () => {
  let app: INestApplication;
  const mockCompaniesService = {};
  const mockImportService = {
    import: jest.fn().mockResolvedValue({ imported: 0, errors: [] }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CompaniesController],
      providers: [
        { provide: CompaniesService, useValue: mockCompaniesService },
        { provide: CompaniesImportService, useValue: mockImportService },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    // No auth guard wired in this bare module (mirrors
    // resumes.upload-limits.spec.ts) — stub req.user so @CurrentUser()
    // resolves for the accept-path test below instead of throwing on
    // user.id.
    app.use(
      (req: { user?: { id: string } }, _res: unknown, next: () => void) => {
        req.user = { id: 'user-1' };
        next();
      },
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a CSV over 1 MB with a clean 4xx, not a raw 500', async () => {
    const overLimit = Buffer.alloc(1 * 1024 * 1024 + 1, 'a');

    const res = await request(app.getHttpServer())
      .post('/companies/import')
      .attach('file', overLimit, {
        filename: 'big.csv',
        contentType: 'text/csv',
      });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(mockImportService.import).not.toHaveBeenCalled();
  });

  it('accepts a CSV under the 1 MB limit and reaches the service', async () => {
    const underLimit = Buffer.from(
      'name,city,businessMode\nAcme,LAHORE,SERVICES',
    );

    const res = await request(app.getHttpServer())
      .post('/companies/import')
      .attach('file', underLimit, {
        filename: 'small.csv',
        contentType: 'text/csv',
      });

    expect(res.status).toBe(201);
    expect(mockImportService.import).toHaveBeenCalledWith(
      'user-1',
      'name,city,businessMode\nAcme,LAHORE,SERVICES',
    );
  });
});
