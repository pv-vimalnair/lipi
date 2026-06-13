# ADR #85 — Phase 2: license validation is offline-only (no backend, ever)

**Date**: June 2026
**Phase**: 2 of the production-readiness roadmap (Offline licensing layer)
**Status**: Accepted
**Supersedes**: n/a (this is the first licensing decision in the project's history)
**Deciders**: project lead (Vimal Nair)

## Context

The project lead's goal is to ship Lipi as a "download and pay" product: a
subscription (monthly or yearly) for individual developers / hobbyists, sold
through the Mac App Store + Microsoft Store (and a direct Stripe checkout on
the project website, since app-store IAP is a hassle for indie tools). The
licensing layer is the foundation of the paid-product model.

The architecture question is: **how do we verify that a user has a valid
license?**

The two main options:

1. **Online verification (a license server).** The app makes an HTTPS
   request to a server on launch (and periodically), the server checks
   the user's subscription status, and returns "valid" / "expired" /
   "revoked". The server is the source of truth.

2. **Offline verification (a signed key).** The user receives a
   cryptographically-signed license key (a JWT-style or JWS-style
   document), the app verifies the signature against an embedded
   public key, and the key is the source of truth. No network
   round-trip.

The codebase has a "no backend, ever" architectural rule (Decision #17,
the original commitment that has shaped the project's design for two
years). The user reaffirmed this rule when picking the production
architecture: the app makes HTTPS calls only to LLM providers (the AI
proxy) and never to a Lipi-owned server. The "no backend" rule is
load-bearing for the project's privacy story (the user knows Lipi
doesn't collect any telemetry, doesn't phone home, doesn't have a way
to leak their data because there is no server to leak it from).

The licensing question is the first place the "no backend" rule
buckles under the weight of a paid product. The standard SaaS
pattern is "online license check + server-side revocation list";
the standard indie-tool pattern (Sublime, BBEdit, JetBrains before
their account system) is "offline signed key + no revocation".
The "no backend" rule points firmly to the indie pattern.

## The options considered

1. **Online license server.** A new Rust service (or a managed
   service like Pusher / Firebase / Supabase) holds the
   subscription state. The app calls it on launch (and
   periodically, e.g. once a day) to check the subscription
   status. The server can revoke a license (e.g. for chargebacks
   or refund requests), and the next status check returns
   "expired". The app refuses to launch without a successful
   server response (or, more leniently, "launches in
   read-only mode until the server is reachable").

   **Selected against.** The "no backend, ever" rule is
   load-bearing for the project's privacy story and the
   user-facing copy ("Lipi doesn't phone home. The
   app makes HTTPS calls only to LLM providers."). An
   online license server is a backend; the rule would
   have to be rewritten to "no backend for the
   application's data, but a license server is
   OK", which is a slippery slope (next phase would
   be "no backend for the application's data, but
   a telemetry server is OK", etc.).

   Additionally, an online license server requires
   operational burden (uptime, monitoring, GDPR-style
   data retention rules, chargeback handling) that
   an indie project with no staff would have to
   absorb. The "no backend" rule is partly an
   architecture choice and partly an ops choice.

2. **Offline signed license key (JWS-style).** A license is a
   cryptographically-signed document. The user receives the
   key (via email, via the App Store receipt, or by
   copy-pasting a code from the project website), the app
   verifies the signature against an embedded public key,
   and the key is the source of truth. No network
   round-trip.

   **Selected.** Matches the "no backend, ever" rule. The
   cost is that the license can't be revoked server-side
   (a refund or chargeback means the user keeps using
   the license until it expires; the project lead has
   to accept this as a cost of doing business). The
   benefit is that the app works offline, the privacy
   story is preserved, and there's no operational
   burden.

3. **Hybrid: signed key + online check (best of both).** The
   app uses the offline signed key as the primary
   verification, and additionally makes a non-blocking
   online check (e.g. "is this license on the
   revocation list?") on launch. The app launches
   even if the online check fails; the online check
   is purely informational.

   **Selected against.** The online check is a
   "phone-home" pattern, which the privacy
   story explicitly rejects. A non-blocking
   check that doesn't affect behavior is
   pure telemetry (we'd be making an
   HTTPS call purely to count "active
   licenses"), which is the same slippery
   slope as option 1.

   Additionally, the revocation list
   itself requires a backend — someone
   has to host the list, sign it (so
   the app can verify it), and update
   it. The "no backend" rule rejects
   this.

## The decision

**Offline signed license key (option 2).** A license is a
JWS-style compact signed document:

```
LIP1.<base64url(payload)>.<base64url(signature)>
```

The payload is JSON with the shape of `LicensePayload` (format,
plan, iat, nbf, exp, sub, jti). The signature is Ed25519 (RFC
8032) over `"LIP1." || base64url(payload)`. The app embeds
the public key as a `const [u8; 32]`; the private key is
in the project lead's CI secret store + a local encrypted
USB drive.

The app does NOT call any server to verify, revoke, or
refresh the license. The Rust side re-verifies the
signature on every `license_get_status` call (Ed25519 is
microseconds, so the cost is negligible), and a
tampered keychain entry fails the signature check.

## The trade-offs

**What we gain:**

- The privacy story is preserved: "Lipi doesn't phone
  home" remains true.
- The app works offline (important for the indie-tool
  market; many users in low-connectivity regions).
- The operational burden is zero: no server to host,
  no monitoring, no data retention rules, no
  chargeback handling.
- The architecture is simpler: the licensing layer is
  a single Rust module + a single TS module + a
  small UI. No network code, no retry logic, no
  rate-limiting.

**What we lose:**

- **No server-side revocation.** A user who buys a
  license and then requests a refund keeps using
  Lipi until the license expires. The project lead
  has to accept this as a cost of doing business.
  (Mitigation: the refund policy is "no refunds on
  annual plans; pro-rated refunds on monthly plans
  only if the request is within 14 days of the
  initial purchase." The 14-day window is
  short enough that the cost is bounded.)

- **No "active license" count.** Without a server, we
  can't count active licenses; we have to estimate
  from the App Store / Microsoft Store sales
  reports. The project lead has to do this
  manually (it's a couple of hours per month).

- **No "transfer to a new machine" via the app.** A
  user who buys a new laptop has to email the
  project lead with their old + new fingerprints
  and a manual re-issue. Phase 3 will add a
  "Transfer" button that emails the project lead
  with both fingerprints; Phase 4 (with the
  sign-license CLI) will make the re-issue
  one-line.

- **Extraction risk on the trial key.** The trial
  private key IS embedded in the binary (so the
  trial can be generated locally). A determined
  attacker can extract it; the worst case is 14
  days of free usage on a single machine. The
  design accepts this trade-off (see Decision
  #86).

## What this decision rules out

- A license server of any kind. The codebase will
  not gain a new service for license verification.
  (Other backends, e.g. an LLM proxy, are still
  fine — Decision #17 is specifically about user
  data and user-facing telemetry, not about
  forwarding API calls to OpenAI.)

- A revocation list, even a non-blocking one. The
  list itself requires a backend; the "no
  backend" rule rejects it.

- A "phone-home" pattern of any kind, even
  purely informational. The privacy story
  explicitly rejects this.

## What this decision enables

- A "trial" license that works offline (no
  signup, no email, no credit card). The
  trial is generated locally on first
  launch; the trial public key is
  embedded; the trial private key is
  embedded (a deliberate trade-off).

- A future "promo code" or "beta tester" flow
  that issues a paid license with a
  discounted plan, without a server. The
  project lead just signs a new key with
  the production private key and emails
  it to the beta tester.

- A future "team license" flow that issues
  one key with multiple machine fingerprints
  in the `sub` claim (a v2 license format
  with a `subs: string[]` field, still
  offline-verifiable).

## References

- `HANDOFF §9.24` — the per-phase writeup of Phase 2.
- `docs/plans/prod-p2-licensing-design.md` — the
  full design doc, including the threat model and
  the JWS-style serialization details.
- `docs/decisions/0017-no-backend-ever.md` — the
  original "no backend, ever" rule that this
  decision extends.
- `HANDOFF §6` "Current phase" — the 9-phase
  production-readiness roadmap; Phase 2 is the
  first step.
- RFC 8032 — Edwards-curve Digital Signature
  Algorithm (EdDSA).
- RFC 7515 — JSON Web Signature (JWS).
