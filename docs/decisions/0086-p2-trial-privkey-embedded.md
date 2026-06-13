# ADR #86 — Phase 2: the trial private key IS embedded in the binary (a bounded trade-off)

**Date**: June 2026
**Phase**: 2 of the production-readiness roadmap (Offline licensing layer)
**Status**: Accepted
**Supersedes**: n/a (this is the first licensing decision in the project's history)
**Deciders**: project lead (Vimal Nair)

## Context

Phase 2 ships an offline-license system. The license is verified
against an embedded public key (Decision #85 — offline-only). The
first-run experience is a 14-day free trial (no credit card, no
signup, no email). The trial is auto-generated on first launch.

The question is: **how is the trial license generated?**

The two main options:

1. **The trial is generated locally on first launch.** The Rust
   binary embeds the trial private key; on first `license_get_status`
   call, the Rust side generates a trial payload (plan: "trial", exp:
   now + 14 days, sub: this machine's fingerprint), signs it with
   the trial private key, and stores the resulting `LIP1.…` key in
   the OS keychain. The trial is a fully-functional license key,
   indistinguishable from a paid license from the verification
   side — only the `plan` field differs.

2. **The trial is a "trial mode" in the app, not a license.** The
   Rust binary does NOT embed a trial private key. The Rust side
   tracks "days since first launch" via the keychain, and after 14
   days, the app starts nagging the user to activate. The
   verification path is separate from the trial-tracking path.

Option 1 is the simpler architecture: the trial is just a license
key with `plan: "trial"`, and the entire licensing layer is
generalized to handle "trial" + "monthly" + "yearly" uniformly. The
trial generation, the trial verification, the trial expiry, and
the trial-to-paid transition are all the same code path as a paid
license.

Option 2 is the more secure architecture: a binary without a
private key can't have its key extracted; the trial-tracking
is a separate, non-cryptographic concept.

The trade-off is: option 1 embeds a private key (which can be
extracted by a determined attacker), but it gives us a clean
architecture and a uniform code path. Option 2 is more secure
but creates a separate "trial mode" concept that doesn't fit
the "everything is a signed license" model.

## The options considered

1. **Embed the trial private key; trial is a signed license.**
   The trial is generated locally on first launch, signed
   with the embedded trial private key, and stored in the
   keychain like any other license. The verification path
   is the same as a paid license. The "trial" plan just
   has a 14-day max `exp`.

   **Selected** (with a caveat, see below).

2. **Don't embed a trial private key; trial is a separate
   tracking concept.** The Rust binary doesn't have a
   trial signing key. The Rust side tracks "days since
   first launch" via a `license_first_launch_at` keychain
   entry, and after 14 days, the app returns `Trial`
   status with `daysRemaining: 0` (or a "trial expired,
   activate to continue" variant). The trial is NOT a
   signed license; it's a "time since first launch" check.

   **Selected against.** This creates a separate
   code path that's almost-but-not-quite like a
   license, which is worse than option 1's
   "trial is a license" model. The trial can't be
   "transferred" to a new machine (the new machine
   starts a fresh 14-day trial, which is a
   feature), but the uniform code path is worth
   more than that benefit.

   Additionally, the "trial as time-since-launch"
   model is fragile: a user who uninstalls + reinstalls
   resets the trial (a feature, but a side effect);
   a user who modifies their system clock can
   extend the trial; a user who wipes their keychain
   can reset the trial. These are all
   recoverable with option 1 (the trial is a
   signed key in the keychain; uninstalling
   removes it; reinstalling generates a new
   one; clock manipulation doesn't affect
   the signed `exp`).

3. **Embed the trial private key, but sign with a
   per-machine ephemeral key on first launch.** The
   Rust binary generates a fresh Ed25519 keypair on
   first launch, embeds the public key, and the
   private key is thrown away. The trial license is
   signed with the ephemeral key. The verification
   uses the embedded ephemeral public key.

   **Selected against.** This is "option 1 with
   extra steps": the same security model (a
   private key in the binary; the worst case is
   "an attacker extracts it"), but the public
   key changes per-install, which means the
   trial can't be "verified" out-of-band
   (e.g. by a future "is this trial valid?"
   tool). Option 1's "trial is signed with a
   well-known, embedded trial private key"
   is simpler.

## The decision

**Embed the trial private key; trial is a signed license
with `plan: "trial"` and a 14-day max `exp`.** The
trade-off is: a determined attacker can extract the
trial private key from the binary, generate fake
trial licenses, and use them on other machines.

The bound on the worst case is the 14-day max `exp`:
even an attacker with the trial private key can
only generate a license that's valid for 14 days
on the machine the license is bound to (the `sub`
claim is the machine fingerprint). The damage is
bounded at 14 days × 1 machine = ~$5 of revenue
at the monthly price (assuming the attacker
otherwise wouldn't have paid). This is the
"indie tool" trade-off; it's the same model
Sublime Text used for years.

The production private key is NOT embedded
(see Decision #85). An attacker with the trial
private key cannot generate paid licenses.

## The trade-off's bound

- **A user who extracts the trial private key** can
  generate a `LIP1.…` key with `plan: "trial"` and
  any `exp` (up to the standard shape validation
  cap of 64 bits, which is effectively infinite).
  They can install this license on any machine.
- **A user who pastes this fake trial key on
  another machine** fails the `sub` (fingerprint)
  check on that other machine; the status returns
  `Invalid { reason: "machine-mismatch" }`. So the
  extracted trial key is still machine-bound.
- **A user who pastes this fake trial key on
  their own machine** gets 14 days of free usage,
  same as the legitimate trial. The "abuse" is
  the ability to reset the trial (uninstall +
  reinstall + re-paste); uninstall + reinstall
  alone also resets the trial (a different
  defense, but the same outcome).
- **The damage is bounded at ~$5 of revenue per
  attacker** (assuming the monthly price of $5,
  the worst case is "the attacker uses Lipi for
  free for 14 days" — same as the legitimate
  trial). The cost of "not having a private key
  in the binary" is a worse architecture
  (option 2's separate trial-tracking path)
  and worse user experience (the trial can't
  be transferred, can't be "backed up", etc.).

## What this decision does NOT do

- It does NOT embed the production private key.
  The production private key is in the project
  lead's CI secret store + a local encrypted USB
  drive. A user with the production private key
  could generate paid licenses for free; the
  cost of that is much higher than the trial
  key (a paid license is a year of free
  usage, not 14 days).

- It does NOT enable a "reset trial" UI.
  Resetting the trial is "uninstall + reinstall
  + paste the extracted trial key" — which is
  the same as "uninstall + reinstall" (the
  latter already resets the trial because
  the trial is in the keychain). Adding a
  UI for it would just make the abuse
  easier.

- It does NOT prevent the trial from being
  shared. Two users on the same machine with
  the same fingerprint (e.g. a shared
  family computer) can both use the trial;
  but the fingerprint is machine-bound, not
  user-bound, so a shared machine is a
  shared trial. This is the same as
  Sublime / BBEdit.

## What this decision enables

- A clean architecture where the trial is
  just a license with `plan: "trial"`. The
  verification path is uniform; the
  "trial-to-paid" transition is a single
  field change (`plan: "monthly"`).

- A future "promo code" or "beta tester"
  flow that issues a paid license with
  a discounted plan, without a
  server. The project lead just signs
  a new key with the production private
  key and emails it to the beta tester.
  The trial key is not involved.

- A future "team license" flow that
  issues one key with multiple machine
  fingerprints in the `sub` claim (a v2
  license format with a `subs: string[]`
  field, still offline-verifiable).

## References

- `HANDOFF §9.24` — the per-phase writeup of Phase 2.
- `docs/plans/prod-p2-licensing-design.md` — the
  full design doc, including the threat model
  and the JWS-style serialization details.
- `docs/decisions/0085-p2-offline-license-validation.md`
  — the parent decision (offline-only verification).
  This decision is a sub-decision: given that
  verification is offline-only, the trial is a
  signed license with an embedded private key.
- RFC 8032 — Edwards-curve Digital Signature
  Algorithm (EdDSA).
