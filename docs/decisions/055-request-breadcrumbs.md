# ADR-055: Request breadcrumbs in Sentry

## Status

Accepted. Amends ADR-051, which turned fetch and XHR breadcrumbs off.

## Date

2026-10-03

## Context

On job `cmur8eszh00010xpomuuc520j` a newly added interview round did not
appear in the list until a reload, although the Timeline showed it. The
backend's request log showed both round creates answered in under 2 s, then
no `GET /jobs/:id` for 19-23 s. The refetch that should follow a create
never reached the backend, and the same flow passes locally, including a
session that starts on an expired access token.

The backend logs only the requests it receives, so a request the browser
never sent leaves no trace there. Browser Sentry sends only error events,
and ADR-051 turned fetch and XHR breadcrumbs off because their URLs can
carry search terms. So when an error does fire, its event cannot show which
API calls ran before it.

## Decision

- **Request breadcrumbs on.** `instrumentation-client.ts` turns on `xhr`
  (Axios sends through XHR) and `fetch` breadcrumbs. Any error event then
  lists the API calls before it, with method, path and status.
- **No query strings.** `withoutUrlQuery` (was `withoutNavigationQuery`)
  strips the query from request URLs as well as navigation URLs, which keeps
  ADR-051's reason for turning them off: `/jobs?search=...` carries what the
  user searched for. Bodies and headers stay off through `dataCollection`.

## Consequences

- An error event shows the sequence of API calls before it, so a missing or
  failed call next to an error is visible in Sentry.
- Breadcrumbs reach Sentry only with an error event. A missing refetch with
  no error still sends nothing; for that, a browser HAR from the session is
  the evidence.

## Alternatives rejected

- **A Caddy access log.** It records only requests that reach the VM, the
  same ones the backend already logs, so it would not have shown a request
  the browser never sent. Its extra coverage (502s during a backend restart,
  history that survives backend deploys) was not worth a second copy of
  client IPs and query strings on the VM.
