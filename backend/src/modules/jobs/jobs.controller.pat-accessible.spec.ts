import 'reflect-metadata';
import { JobsController } from './jobs.controller.js';
import { PAT_ACCESSIBLE_KEY } from '../../common/decorators/pat-accessible.decorator.js';

// @PatAccessible() is a manually-applied, per-route opt-in with nothing else
// enumerating or locking the allowlist - a handler copy-pasted (decorators
// included) from create()/parseJobPosting() would silently widen what a
// leaked personal access token can reach. This test pins the exact set of
// methods that carry the decorator so that drift fails CI instead of going
// unnoticed. See PatScopeGuard / pat-scope.guard.spec.ts for the enforcement
// side.
describe('JobsController @PatAccessible() allowlist', () => {
  const EXPECTED_PAT_ACCESSIBLE_METHODS = new Set([
    'create',
    'parseJobPosting',
  ]);

  const methodNames = Object.getOwnPropertyNames(
    JobsController.prototype,
  ).filter((name) => name !== 'constructor');

  it('only marks the intended methods as PAT-accessible', () => {
    const actual = methodNames.filter((name) =>
      Reflect.getMetadata(
        PAT_ACCESSIBLE_KEY,
        JobsController.prototype[name as keyof JobsController],
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
