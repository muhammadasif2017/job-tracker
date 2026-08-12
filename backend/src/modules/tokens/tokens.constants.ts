export const API_TOKEN_PREFIX = 'jt_pat_';

// How long a personal access token is valid for from creation, absent a
// manual revoke. Bounds exposure from a forgotten/never-revoked token.
export const PAT_EXPIRY_DAYS = 180;

// Guards against unbounded ApiToken accumulation (accidental double-submits,
// runaway scripts) — not a real security boundary on its own.
export const MAX_ACTIVE_TOKENS_PER_USER = 20;

// JWT `scope` claim stamped on access tokens minted from a PAT exchange
// (AuthService.exchangeApiToken). Absent entirely on normal login/refresh
// tokens, which stay full-access. Routes must opt in via @PatAccessible()
// to accept this scope — see PatScopeGuard.
export const PAT_SCOPE = 'pat';

// Compared against with bcrypt when a PAT id doesn't exist / is revoked, so
// that branch takes roughly the same time as a real secret mismatch instead
// of returning early - closes a timing oracle that would otherwise let a
// caller distinguish "id doesn't exist" from "id exists, wrong secret".
export const DUMMY_TOKEN_HASH =
  '$2b$10$5c4QKoY7x6w/J5a/vj5reucQpoxIHVRfy91xWsZhuvYgNMqjNjNQ.';
