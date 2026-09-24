import {
  INestApplication,
  VERSION_NEUTRAL,
  VersioningType,
} from '@nestjs/common';

/** The API version every route is served under: `/v1/...`. */
export const CURRENT_API_VERSION = '1';

/** The URL prefix the current version adds, for code that builds paths by hand. */
export const CURRENT_API_PREFIX = `/v${CURRENT_API_VERSION}`;

/**
 * Serves every route at `/v1/...` and, for now, also at its old unversioned
 * path (ADR-047). The alias keeps clients that predate versioning working:
 * an installed browser extension, a browser tab still running the previous
 * frontend build. A route that must never move — `/health` for probes, the
 * OAuth routes whose callback URLs are registered with Google and GitHub —
 * opts out with `@Version(VERSION_NEUTRAL)`.
 *
 * Called from `main.ts` and mirrored in `test/app.e2e-spec.ts`, so both
 * serve the same URLs.
 */
export function applyApiVersioning(app: INestApplication) {
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: [CURRENT_API_VERSION, VERSION_NEUTRAL],
  });
}

/**
 * Drops the unversioned aliases from an OpenAPI document, so the docs and the
 * frontend's generated types describe each route once, at its `/v1` path.
 * A path with no `/v1` twin is kept: it is version-neutral on purpose
 * (`/health`, the OAuth routes).
 */
export function withoutUnversionedAliases<
  T extends { paths: Record<string, unknown> },
>(document: T): T {
  const paths = Object.fromEntries(
    Object.entries(document.paths).filter(
      ([path]) =>
        path.startsWith(`${CURRENT_API_PREFIX}/`) ||
        !(`${CURRENT_API_PREFIX}${path}` in document.paths),
    ),
  );
  return { ...document, paths };
}
