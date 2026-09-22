import 'reflect-metadata';
import { JobParsingController } from './job-parsing.controller.js';
import { PAT_ACCESSIBLE_KEY } from '../../common/decorators/pat-accessible.decorator.js';

// @PatAccessible() is a manually-applied, per-route opt-in with nothing else
// enumerating or locking the allowlist - a handler copy-pasted (decorators
// included) from parseJobPosting() would silently widen what a leaked personal
// access token can reach. This test pins the exact set of methods that carry
// the decorator so that drift fails CI instead of going unnoticed. See
// PatScopeGuard / pat-scope.guard.spec.ts for the enforcement side.
//
// parseJobPosting() used to live on JobsController and was pinned by
// jobs.controller.pat-accessible.spec.ts; the allowlist is now split across
// both files, one per controller that opts a route in.
describe('JobParsingController @PatAccessible() allowlist', () => {
  const EXPECTED_PAT_ACCESSIBLE_METHODS = new Set(['parseJobPosting']);

  const methodNames = Object.getOwnPropertyNames(
    JobParsingController.prototype,
  ).filter((name) => name !== 'constructor');

  it('only marks the intended methods as PAT-accessible', () => {
    const actual = methodNames.filter((name) =>
      Reflect.getMetadata(
        PAT_ACCESSIBLE_KEY,
        JobParsingController.prototype[name as keyof JobParsingController],
      ),
    );
    expect(new Set(actual)).toEqual(EXPECTED_PAT_ACCESSIBLE_METHODS);
  });

  it('covers every method actually defined on the controller (catches typos above)', () => {
    for (const expected of EXPECTED_PAT_ACCESSIBLE_METHODS) {
      expect(methodNames).toContain(expected);
    }
  });
});
