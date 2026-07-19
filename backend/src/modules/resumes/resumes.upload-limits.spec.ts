import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { ResumesController } from './resumes.controller.js';
import { ResumesService } from './resumes.service.js';

// Exercises the real HTTP pipeline (FileInterceptor's multer limits), unlike
// resumes.controller.spec.ts which calls uploadResume() directly and bypasses
// multer's fileSize limit entirely.
describe('ResumesController upload size limit (HTTP pipeline)', () => {
  let app: INestApplication;
  const mockService = {
    upload: jest.fn().mockResolvedValue({ id: 'r-1' }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ResumesController],
      providers: [
        { provide: ResumesService, useValue: mockService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a PDF over 8 MB with 413 and never calls the service', async () => {
    const overLimit = Buffer.alloc(8 * 1024 * 1024 + 1, 'a');

    const res = await request(app.getHttpServer())
      .post('/jobs/j-1/resumes')
      .attach('file', overLimit, {
        filename: 'big.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(413);
    expect(mockService.upload).not.toHaveBeenCalled();
  });
});
