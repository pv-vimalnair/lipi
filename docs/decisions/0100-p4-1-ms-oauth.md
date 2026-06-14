# Decision #100 — Microsoft Store OAuth client-credentials flow (replaces static token)

**Date**: June 2026
**Phase**: 4.1 of the production-readiness roadmap
**Deciders**: project lead (Vimal Nair)
**Status**: Accepted + implemented

## Context

Phase 4 (IAP receipt validation) shipped with a
**static Microsoft Store Broker API bearer token**
read from the `LIPI_MS_IAP_BEARER_TOKEN`
environment variable. The static-token approach
was chosen for simplicity in Phase 4, with a
"v1.1 follow-up" note in the design doc and
HANDOFF §9.27 to replace it with a real OAuth
flow.

The static-token approach has three problems:

1. **Token rotation is manual.** The project
   lead has to manually generate a new token
   in the Azure portal every 60 days (Microsoft
   tokens have a 60-minute lifetime in
   practice, but the Azure AD app registration
   has its own rotation policy). If the project
   lead forgets, the IAP redemption silently
   breaks.
2. **The token is long-lived and powerful.**
   Anyone with the token can call the Broker
   API on behalf of the Lipi Azure AD app,
   including listing all subscriptions. The
   token should be short-lived and
   automatically rotated.
3. **The token is shared across machines.**
   Every Lipi install uses the same static
   token, so a leaked token (e.g. from a CI
   log, a developer's terminal history) can be
   used by an attacker to call the Broker API.

The Microsoft Store Broker API uses OAuth 2.0
**client-credentials** for service-to-service
auth (the app is the client; the user is not
involved). The app's Azure AD app registration
provides the `client_id` + `client_secret` +
`tenant_id`. These are long-lived credentials
that the project lead rotates manually, but the
**access token** derived from them is
short-lived (60 minutes).

## Decision

Replace the static `LIPI_MS_IAP_BEARER_TOKEN`
env var with a real **OAuth 2.0
client-credentials flow** that:

1. **Reads the OAuth credentials** at call
   time from:
   - `LIPI_MS_IAP_CLIENT_ID`
   - `LIPI_MS_IAP_CLIENT_SECRET`
   - `LIPI_MS_IAP_TENANT_ID`
2. **Exchanges them for an access token** at
   `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`
   with `grant_type=client_credentials` and
   `scope=https://api.store.microsoft.com/.default`.
3. **Caches the access token in memory**
   (process-local) for **55 minutes**
   (Microsoft's 60-minute lifetime minus a
   5-minute safety margin against clock drift
   + request latency).
4. **Transparently refreshes** the token on
   the next `verify_microsoft_receipt` call
   when the cache is empty or the token is
   expired.
5. **Falls back to the static
   `LIPI_MS_IAP_BEARER_TOKEN`** if the OAuth
   env vars are unset. This is preserved as a
   dev-only escape hatch (e.g. for local
   development without Azure AD credentials).

The new code lives in a dedicated
`iap_oauth.rs` module (the same pattern as
`iap_apple.rs` and `iap_microsoft.rs` for
separation of concerns + testability). The
`verify_microsoft_receipt` function is updated
to use `iap_oauth::get_access_token` instead
of reading the env var directly.

## Why client-credentials (not authorization-code)?

The Microsoft Store Broker API uses
client-credentials. The app is the client; the
user is not involved. The Azure AD app
registration has the
`https://api.store.microsoft.com/.default`
scope and admin consent. No user interaction
is needed (no browser, no consent dialog).

## Why process-local cache (not persistent)?

A persistent cache (file-based) would survive
app restarts and avoid the OAuth exchange on
every cold start. But:

- The OAuth exchange is fast (< 500ms in
  practice; typically ~100ms for a regional
  Azure AD endpoint).
- The OAuth exchange requires the
  `client_secret` to be in the keychain (it's
  a build-time env var in our setup, not in
  the keychain). A persistent cache would
  require storing the access token somewhere,
  and the access token is still a credential
  that should be protected.
- A process-local cache is the simplest option
  that doesn't add a new persistence layer.
- The 5-minute safety margin means we never
  hit a "token expired mid-request" race.

## Why cap TTL at 55 minutes (not the full 60)?

Microsoft's access tokens have a 60-minute
lifetime. We use 55 minutes as the cache TTL
to give a 5-minute safety margin against:

- Clock drift between the Lipi app's clock
  and Azure AD's clock.
- Request latency (the receipt-validation
  request can take 1-2 seconds, so we want
  the token to be valid for at least 5 more
  minutes after we receive it).
- The OAuth endpoint's `expires_in` being
  slightly less than 60 minutes in practice
  (some tenants have shorter lifetimes).

If the server returns a `expires_in` < 55
minutes (e.g. a tenant with a shorter
lifetime), we use that value instead. The 55
minutes is an upper bound, not a fixed value.

## What happens if the OAuth env vars are unset?

Two cases:

1. **All three OAuth env vars are unset, AND
   `LIPI_MS_IAP_BEARER_TOKEN` is unset.** The
   Rust side returns
   `iap-oauth-credentials-missing`. The UI
   humanizes this reason with "Microsoft
   Store IAP is not configured in this
   build. Please paste a license key
   instead."
2. **All three OAuth env vars are unset, AND
   `LIPI_MS_IAP_BEARER_TOKEN` is set.** The
   Rust side uses the static token (dev
   escape hatch). This is preserved for
   local development without Azure AD
   credentials. The CI is updated to set
   the OAuth env vars instead of the static
   token.

## Alternatives considered

### A. Keep the static token, just rotate it more often

**Rejected.** Even with manual rotation every
30 days, the token is still long-lived and
shared across machines. The OAuth flow is a
strict improvement on every dimension (security,
automation, auditability).

### B. Use a persistent file-based cache

**Rejected.** A file-based cache would survive
app restarts and avoid the OAuth exchange on
every cold start. But:

- The OAuth exchange is fast (< 500ms), so the
  latency saving is minimal.
- A file-based cache requires storing the
  access token somewhere, and the access token
  is still a credential that should be
  protected.
- A process-local cache is the simplest option
  that doesn't add a new persistence layer.

### C. Use a system browser for interactive auth (Authorization Code flow)

**Rejected.** The Microsoft Store Broker API
uses client-credentials. The app is the
client; the user is not involved. The
Authorization Code flow would require a
browser redirect + a local callback server,
adding significant complexity for no
benefit.

### D. Use a cloud-synced keychain (e.g. iCloud Keychain, Microsoft Account)

**Rejected.** Violates the "no backend, ever"
principle (Decision #17). The cloud-synced
keychain is a backend from the perspective
of the OAuth flow.

## Impact

- **Code:** ~180 lines in `iap_oauth.rs` (the
  new module) + ~20 lines changed in
  `iap_microsoft.rs` (use the new module) + ~10
  lines in `iap.rs` (expose the new `iap_refresh_license`
  error reason `iap-oauth-credentials-missing`).
- **Tests:** 18 new unit tests in
  `iap_oauth::tests` (covering token parsing,
  expiration, TTL capping, URL construction,
  error display, and the static-token
  fallback).
- **CI:** The CI is updated to set the OAuth
  env vars instead of the static token. The
  Azure AD app registration is created in
  the Azure portal (the project lead's setup
  task; not in the code).
- **Docs:** Updated `iap_microsoft.rs` module
  docs + new `iap_oauth.rs` module docs +
  updated `CHANGELOG.md` + new HANDOFF §9.28.

## References

- `HANDOFF.md §6 "Current phase: Phase 4.1 — IAP v1.1 follow-ups — SHIPPED"`
- `HANDOFF.md §9.28` — the per-phase writeup
- `docs/plans/prod-p4-1-iap-followups-design.md` — the design doc
- `docs/decisions/0097-p4-iap-per-machine-keypair.md` — the related IAP keypair decision
- Microsoft's OAuth 2.0 client-credentials flow:
  https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow
