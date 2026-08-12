import { SetMetadata } from '@nestjs/common';

export const PAT_ACCESSIBLE_KEY = 'patAccessible';

// Opt-in marker for routes a PAT-scoped access token (see PatScopeGuard,
// AuthService.exchangeApiToken) is allowed to call. Everything else rejects
// PAT-scoped tokens even though the JWT itself is otherwise valid - keeps a
// leaked personal access token from reaching endpoints it was never issued
// for (change password, delete account, mint more tokens, admin routes...).
export const PatAccessible = () => SetMetadata(PAT_ACCESSIBLE_KEY, true);
