import { scrubLogAttributes } from './log-attributes.helper.js';

describe('scrubLogAttributes', () => {
  it('keeps allowlisted fields and the attributes Sentry adds itself', () => {
    expect(
      scrubLogAttributes({
        requestId: 'req-1',
        context: 'CompanyEnrichmentProcessor',
        jobId: '42',
        'sentry.release': 'abc123',
        'pino.logger.level': 40,
      }),
    ).toEqual({
      requestId: 'req-1',
      context: 'CompanyEnrichmentProcessor',
      jobId: '42',
      'sentry.release': 'abc123',
      'pino.logger.level': 40,
    });
  });

  it('drops any field not on the allowlist, such as an email address', () => {
    const kept = scrubLogAttributes({
      to: 'someone@example.com',
      subject: 'Interview tomorrow',
      requestId: 'req-2',
    });

    expect(kept).toEqual({ requestId: 'req-2' });
  });

  it('keeps only the method and query-free path of a request, never its headers', () => {
    const kept = scrubLogAttributes({
      req: {
        method: 'GET',
        url: '/v1/jobs?search=acme',
        headers: { cookie: 'jt_refresh=secret', host: 'api.example' },
        remoteAddress: '203.0.113.7',
      },
      res: { statusCode: 500, headers: { 'set-cookie': 'x' } },
    });

    expect(kept).toEqual({
      'http.request.method': 'GET',
      'url.path': '/v1/jobs',
      'http.response.status_code': 500,
    });
  });

  it('keeps the type, message and stack of a logged error', () => {
    const kept = scrubLogAttributes({
      err: {
        type: 'Error',
        message: 'ECONNREFUSED',
        stack: 'Error: ECONNREFUSED\n    at x',
        config: { headers: { Authorization: 'Bearer secret' } },
      },
    });

    expect(kept).toEqual({
      'error.type': 'Error',
      'error.message': 'ECONNREFUSED',
      'error.stack': 'Error: ECONNREFUSED\n    at x',
    });
  });

  it('ignores req, res and err values that are not objects', () => {
    expect(scrubLogAttributes({ req: 'GET /', res: null, err: 7 })).toEqual({});
  });
});
