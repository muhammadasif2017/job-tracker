import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateJobDto } from './update-job.dto.js';

// The whole "clear a field by sending null" path (ADR-022) rests on
// `@IsOptional()` skipping the other validators for null as well as
// undefined — without that, `url: null` would be rejected by `@IsUrl()`
// before it ever reached the service.
describe('UpdateJobDto', () => {
  const propertiesOf = async (payload: Record<string, unknown>) => {
    const errors = await validate(
      plainToInstance(UpdateJobDto, payload) as object,
    );
    return errors.map((e) => e.property).sort();
  };

  it('accepts an explicit null on every nullable optional field', async () => {
    expect(
      await propertiesOf({
        url: null,
        location: null,
        notes: null,
        discoverySource: null,
        applicationChannel: null,
      }),
    ).toEqual([]);
  });

  it('still rejects a malformed value on those fields', async () => {
    expect(await propertiesOf({ url: 'not-a-url' })).toEqual(['url']);
    expect(await propertiesOf({ discoverySource: 'NOPE' })).toEqual([
      'discoverySource',
    ]);
  });
});
