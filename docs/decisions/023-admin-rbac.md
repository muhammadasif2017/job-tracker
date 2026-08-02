# ADR-023: Role-based admin panel — global `RolesGuard`, self-delete block, shared deletion path

## Status
Accepted

## Date
2026-08-02

## Context

The product needed a minimal admin surface: list/search registered users,
view one, delete one. No prior authorization concept beyond "is this the
resource owner" existed — every other module's access control is
`findFirst({ where: { id, userId } })`-style ownership scoping (see
`backend/CLAUDE.md`, "Jobs: Authorization Pattern"), which has no notion of
one user acting on another user's data at all.

`JwtAuthGuard` was already global (`main.ts`, documented in
`backend/CLAUDE.md`), so "is authenticated" was solved. "Is authenticated
**and** privileged" was not, and there was no existing per-route
capability-check mechanism to extend.

## Decision

### `Role` enum on `User`, checked by a second global guard

```prisma
enum Role {
  USER
  ADMIN
}

model User {
  role Role @default(USER)
  // ...
}
```

`RolesGuard` (`common/guards/roles.guard.ts`) reads `@Roles(Role.ADMIN)`
metadata off the handler/class via `Reflector` and checks
`requiredRoles.includes(user.role)`; it no-ops (`return true`) when a route
carries no `@Roles()` metadata, so it's safe to register globally without
annotating every existing controller.

Registered in `main.ts` alongside `JwtAuthGuard`, in that order:

```ts
app.useGlobalGuards(
  new JwtAuthGuard(app.get(Reflector)),
  new RolesGuard(app.get(Reflector)),
);
```

Order matters: `RolesGuard` reads `req.user`, which only exists once
`JwtAuthGuard` has run and attached it. `AdminController` is the only
consumer today (`@Roles(Role.ADMIN)` at the controller class level, so it
applies to every handler in it).

`useGlobalGuards` (imperative, in `main.ts`) was used instead of the
`APP_GUARD` DI-token pattern `ThrottlerGuard` uses in `app.module.ts`.
`JwtAuthGuard` was already registered that way before this feature (see
`backend/CLAUDE.md`, "Auth Architecture: Global Protection"), and
`RolesGuard` has to run immediately after it, so it was registered
alongside rather than through a different mechanism. The split between the
two registration styles in this codebase is historical, not a rule.

### Ownership pattern doesn't apply here — `AdminService` acts across users by design

Unlike every other service (`ensureJobOwned`, `findFirst({ userId })`),
`AdminService.listUsers`/`getUser`/`deleteUser` intentionally do **not**
scope by the requesting user's ID — the entire point is one privileged user
acting on arbitrary other users' rows. The only identity check is
`@Roles(Role.ADMIN)` at the guard level, plus the self-delete guard below.

### Self-delete is blocked, not merely discouraged

```ts
async deleteUser(requestingUserId: string, targetUserId: string) {
  if (requestingUserId === targetUserId) {
    throw new ForbiddenException(
      'Cannot delete your own account from the admin panel',
    );
  }
  await this.getUser(targetUserId); // 404 if missing
  await this.usersService.deleteById(targetUserId);
  return { message: 'User deleted' };
}
```

Checked first — before the target-existence lookup and before the delete
call itself — as a hard `ForbiddenException`, not a UI-only warning.
There's a separate, unrelated self-service `deleteAccount` path for users
who want to delete their own account; admin deletion is not meant to
substitute for it.

### Admin deletion reuses the self-service deletion path (`UsersService.deleteById`)

```ts
// Shared by self-delete (deleteAccount) and admin-initiated deletion.
async deleteById(userId: string) {
  const resumes = await this.prisma.resume.findMany({
    where: { job: { userId } },
    select: { storageKey: true },
  });
  await this.prisma.user.delete({ where: { id: userId } });
  await Promise.all(/* delete each resume's storage key */);
}
```

One deletion path, two callers (`deleteAccount` on your own account,
`AdminService.deleteUser` on someone else's), rather than a duplicated
admin-specific delete routine. `User.jobs` cascades (`onDelete: Cascade`),
and every `Job` child (`JobEvent`, `CompanyProfile`, `Resume`,
`InterviewRound`, `Contact`) cascades from `Job` in turn — the DB handles
the full row tree in one `user.delete` call. Storage files are not part of
the DB cascade (they live outside Postgres), so `storageKey`s are collected
**before** the delete and cleaned up **after** it commits.

### Client-side gating is UX-only; enforcement is server-side

The "Admin" nav link only renders for `user?.role === 'ADMIN'`
(`sidebar.tsx`), but `app/(dashboard)/admin/users/page.tsx` itself has no
role check — a non-admin who navigates to `/admin/users` directly gets a
page shell whose queries all 403 from the backend. This is intentional
economy, not an oversight: `RolesGuard` is the actual boundary; the nav
check only avoids showing the link to people who'd bounce off it.

## Alternatives Considered

### Permissions/scopes system instead of a single `Role` enum
Rejected: one binary distinction (regular user vs. admin) is the entire
current requirement. A permissions table or scope list is speculative
complexity for a capability set of exactly one ("can manage users") —
CLAUDE.md's "don't design for hypothetical future requirements" applies
directly.

### Per-user `userId` check on `Contact`-style child rows extended to `AdminService`
Not applicable: `AdminService` operates on `User` rows directly, not
job-owned child records, so there is no parent-ownership chain to check
through in the first place — the `ensureJobOwned` pattern (ADR-015,
ADR-022) doesn't map onto "an admin acting on another user's account."

### Separate admin-only deletion routine instead of reusing `deleteById`
Rejected: would duplicate the storage-cleanup-after-cascade ordering in two
places, with two chances to get the "collect keys before delete, clean up
after" sequencing wrong. Reusing the existing self-service path guarantees
both callers get identical cleanup semantics.

### Redirect non-admins away from `/admin/users` client-side
Rejected as unnecessary for now: the backend 403s regardless, so a
client-side redirect would only improve the error presentation, not close
a security gap. Left as a possible follow-up if the empty/error page state
turns out to be confusing in practice.

## Consequences
- Any new privileged (non-owner-scoped) route must add `@Roles(Role.ADMIN)`
  explicitly — `RolesGuard`'s no-op-when-unannotated default means a route
  with no `@Roles()` is reachable by any authenticated user, same as today.
- Promoting a user to `ADMIN` has no in-app flow (no self-serve promotion,
  no admin-promotes-another-admin UI) — it's a direct DB/Prisma Studio
  operation. Acceptable for the current single-operator scale; would need a
  real flow (and probably an audit trail) before a multi-admin deployment.
- `deleteById`'s storage-cleanup ordering (keys collected pre-delete,
  deleted post-commit) is now load-bearing for two call sites instead of
  one — a future change to either caller's expectations needs to consider
  the other.
- No audit log of admin actions (who deleted which user, when) exists.
  Acceptable today given the single-admin scale; would be a prerequisite
  for any multi-admin trust model.
