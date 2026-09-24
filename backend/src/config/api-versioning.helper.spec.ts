import { VERSION_NEUTRAL, VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import {
  applyApiVersioning,
  CURRENT_API_PREFIX,
  withoutUnversionedAliases,
} from './api-versioning.helper.js';

describe('applyApiVersioning', () => {
  it('serves routes under /v1 and keeps the unversioned alias', () => {
    const app = { enableVersioning: jest.fn() };

    applyApiVersioning(app as unknown as INestApplication);

    expect(CURRENT_API_PREFIX).toBe('/v1');
    expect(app.enableVersioning).toHaveBeenCalledWith({
      type: VersioningType.URI,
      defaultVersion: ['1', VERSION_NEUTRAL],
    });
  });
});

describe('withoutUnversionedAliases', () => {
  it('keeps each route once, at its /v1 path', () => {
    const doc = withoutUnversionedAliases({
      openapi: '3.0.0',
      paths: {
        '/v1/jobs': { get: {} },
        '/jobs': { get: {} },
        '/v1/jobs/{id}': { get: {} },
        '/jobs/{id}': { get: {} },
      },
    });

    expect(Object.keys(doc.paths)).toEqual(['/v1/jobs', '/v1/jobs/{id}']);
    expect(doc.openapi).toBe('3.0.0');
  });

  it('keeps version-neutral routes that have no /v1 twin', () => {
    const doc = withoutUnversionedAliases({
      paths: { '/health': {}, '/auth/google': {}, '/v1/auth/me': {} },
    });

    expect(Object.keys(doc.paths)).toEqual([
      '/health',
      '/auth/google',
      '/v1/auth/me',
    ]);
  });
});
