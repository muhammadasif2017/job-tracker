import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JobStatus } from '@prisma/client';
import { JobQueryDto } from './job-query.dto.js';

// `statusIn` is what lets the kanban board ask for only the statuses it
// renders. Express hands a query param over as a string when it appears once
// and an array when it repeats, so the transform has to normalize both before
// `@IsEnum(..., { each: true })` sees it.
describe('JobQueryDto.statusIn', () => {
  const parse = async (value: unknown) => {
    const dto = plainToInstance(JobQueryDto, { statusIn: value });
    const errors = await validate(dto as object);
    return { dto, properties: errors.map((e) => e.property) };
  };

  it('splits a comma-separated param into an array', async () => {
    const { dto, properties } = await parse('WISHLIST,APPLIED');
    expect(properties).toEqual([]);
    expect(dto.statusIn).toEqual([JobStatus.WISHLIST, JobStatus.APPLIED]);
  });

  it('accepts a repeated param that already arrives as an array', async () => {
    const { dto, properties } = await parse([
      JobStatus.WISHLIST,
      JobStatus.OFFER,
    ]);
    expect(properties).toEqual([]);
    expect(dto.statusIn).toEqual([JobStatus.WISHLIST, JobStatus.OFFER]);
  });

  it('rejects a value that is not a JobStatus', async () => {
    expect((await parse('WISHLIST,NOPE')).properties).toEqual(['statusIn']);
  });
});

// plainToInstance is not how Nest invokes class-transformer. The global pipe
// runs with whitelist + forbidNonWhitelisted + transform (see main.ts), which
// strips undeclared keys and changes how @Transform composes — so exercise the
// real pipe with the real options rather than trusting the unit calls above.
describe('JobQueryDto under the global ValidationPipe', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });
  const metadata = {
    type: 'query' as const,
    metatype: JobQueryDto,
    data: '',
  };

  it('parses the kanban board query string the way Express delivers it', async () => {
    const result = (await pipe.transform(
      { limit: '100', statusIn: 'WISHLIST,APPLIED,INTERVIEWING,OFFER' },
      metadata,
    )) as JobQueryDto;

    expect(result.statusIn).toEqual([
      JobStatus.WISHLIST,
      JobStatus.APPLIED,
      JobStatus.INTERVIEWING,
      JobStatus.OFFER,
    ]);
    expect(result.limit).toBe(100);
  });

  it('rejects an unknown status instead of silently dropping the filter', async () => {
    await expect(
      pipe.transform({ statusIn: 'WISHLIST,NOPE' }, metadata),
    ).rejects.toThrow();
  });
});
