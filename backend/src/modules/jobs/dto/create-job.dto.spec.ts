import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateJobDto } from './create-job.dto.js';

describe('CreateJobDto', () => {
  const parse = async (payload: Record<string, unknown>) => {
    const dto = plainToInstance(CreateJobDto, payload);
    const errors = await validate(dto as object);
    return { dto, properties: errors.map((e) => e.property).sort() };
  };

  it('trims surrounding whitespace off the free-text fields', async () => {
    const { dto, properties } = await parse({
      company: '  Acme Corp  ',
      position: '  Senior Engineer ',
      location: ' Remote ',
    });

    expect(properties).toEqual([]);
    expect(dto.company).toBe('Acme Corp');
    expect(dto.position).toBe('Senior Engineer');
    expect(dto.location).toBe('Remote');
  });

  it('folds styled Unicode to NFKC so the search box can match what was stored', async () => {
    // Mathematical Bold letters, the shape a company name arrives in when
    // pasted out of a LinkedIn post. buildJobWhere already NFKC-normalizes
    // the search *term*; without the same fold on write, no term the user
    // could type would ever match this row.
    const { dto, properties } = await parse({
      company: '\u{1D400}\u{1D41C}\u{1D426}\u{1D41E}',
      position: 'Engineer',
      notes: '\u{1D411}emote team',
    });

    expect(properties).toEqual([]);
    expect(dto.company).toBe('Acme');
    expect(dto.notes).toBe('Remote team');
  });

  it('rejects a whitespace-only company instead of storing a blank label', async () => {
    // Untrimmed, "   " passes @IsNotEmpty() and then resolveCompanyId trims
    // it to "" — storing a blank company with a null companyId.
    expect(
      (await parse({ company: '   ', position: 'Engineer' })).properties,
    ).toEqual(['company']);
  });
});
