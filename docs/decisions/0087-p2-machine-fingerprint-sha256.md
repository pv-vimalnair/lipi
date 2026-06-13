# ADR #87 — Phase 2: machine fingerprint is SHA-256 of `hostname || username || mac_address`

**Date**: June 2026
**Phase**: 2 of the production-readiness roadmap (Offline licensing layer)
**Status**: Accepted
**Supersedes**: n/a (this is the first licensing decision in the project's history)
**Deciders**: project lead (Vimal Nair)

## Context

Phase 2 binds a license to a specific machine. The license
payload's `sub` claim is the machine fingerprint — a stable,
unique-per-machine identifier. The Rust side computes the
fingerprint on every `license_get_status` call and compares it
to the `sub` claim; a mismatch returns `Invalid { reason:
"machine-mismatch" }`.

The question is: **how do we compute a machine fingerprint?**

The fingerprint needs three properties:

1. **Stable across reboots.** The same machine has the same
   fingerprint across reboots, OS updates, app reinstalls, etc.
2. **Unique per machine.** Two distinct machines have distinct
   fingerprints (with very high probability).
3. **Non-secret.** The fingerprint is shown in the UI ("your
   machine's fingerprint is `abc123…`") and is included in
   the "please issue me a license" support email. It must
   not leak any sensitive information (e.g. the actual
   MAC address, the OS username, the hostname).

The three common "machine ID" inputs are:

- **Hostname** (`gethostname(2)` on Unix, `GetComputerNameExW`
  on Windows) — usually unique, but can be "DESKTOP-ABC123"
  (Windows default) which is per-install, not per-machine.
  Multiple machines on the same network can have the same
  hostname if they're not properly named.
- **Username** (`USER` / `USERNAME` env var) — usually unique
  per machine (most people have one user account per machine),
  but not guaranteed (a family computer can have multiple
  users; an office computer can have a single "office" user
  on every machine).
- **MAC address** (the first non-loopback MAC) — unique per
  network interface, stable across reboots. The catch: a
  VM shares the host's MAC (cloned VMs have the host's MAC);
  USB WiFi adapters can change the MAC when plugged in;
  some privacy-focused OSes randomize the MAC on every
  connect.

## The options considered

1. **Hostname only.** The fingerprint is just the hostname.
   **Selected against.** The Windows default hostname
   ("DESKTOP-ABC123") is per-install, not per-machine,
   so a clean reinstall would change the fingerprint
   and invalidate the license. Multi-user machines with
   the same hostname (e.g. office computers named
   "OFFICE-PC") would collide.

2. **MAC address only.** The fingerprint is just the
   first non-loopback MAC.
   **Selected against.** VMs share the host's MAC
   (a cloned VM has the host's MAC); a user who
   clones a VM keeps the same fingerprint and the
   same license. USB adapters can change the MAC;
   some users have multiple NICs and the "first
   non-loopback" can change based on which one is
   up.

3. **Hash of `hostname || username || mac_address`.**
   The fingerprint is a SHA-256 of the three
   inputs concatenated with a separator.
   **Selected.** The combination is:
   - **Stable across reboots** (none of the
     three inputs change on a single machine).
   - **Unique per machine** (collisions require
     identical hostname + username + MAC, which
     is essentially impossible in practice —
     a user would have to deliberately set all
     three to match another machine).
   - **Non-secret** (the hash is one-way;
     the user can see the hash in the UI
     without revealing the inputs).
   - **Cheap** (one `gethostname(2)`, one env-var
     read, one MAC lookup, one SHA-256 of a
     ~100-byte buffer — total < 1ms).

4. **OS-provided machine ID.** Modern OSes have a
   "machine ID" concept (Windows has `MachineGuid`
   in the registry, macOS has `IOPlatformUUID`,
   Linux has `/etc/machine-id`). These are
   designed exactly for this use case.
   **Selected against.** The three OSes have
   three different APIs (`RegQueryValueExW` on
   Windows, `IOKit` on macOS, `read /etc/machine-id`
   on Linux), and the values are formatted
   differently (Windows GUIDs are 16 bytes,
   macOS UUIDs are 16 bytes, Linux machine-id
   is 32 hex chars). Normalizing them to a
   single string format is more code than the
   SHA-256-of-three-inputs approach, and the
   result is the same (a stable, unique-per-
   machine identifier). The OS-provided IDs
   are slightly more "official" but also
   slightly more fragile (e.g. Linux's
   `/etc/machine-id` is regenerated on
   certain system reconfigurations;
   macOS's `IOPlatformUUID` changes on
   logic-board replacement).

## The decision

**SHA-256 of `hostname || "\n" || username || "\n" || mac_address`,
hex-encoded to 64 lowercase hex characters.** The three inputs
are concatenated with `"\n"` separators to avoid ambiguity
(e.g. a hostname of "ab" and a username of "c" should hash
differently from a hostname of "a" and a username of "bc").

The hash is one-way: the user can see the fingerprint in
the UI without revealing the hostname, username, or MAC.
A user who needs to email the project lead to get a
license issued includes the fingerprint in the email
("my fingerprint is `abc123…`"), and the project lead
can verify the fingerprint is for the user's machine
(but cannot recover the hostname, username, or MAC from
it — and doesn't need to).

## The implementation

- **Hostname**: `hostname::get()` (the `hostname` Rust crate,
  v0.4). Falls back to `"unknown-host"` on error.
- **Username**: `whoami::username()` (the `whoami` Rust
  crate, v1). Returns the OS username (USER on Unix,
  USERNAME on Windows).
- **MAC**: `mac_address::get_mac_address()` (the
  `mac_address` Rust crate, v1). Returns the first
  non-loopback MAC. Falls back to `"unknown-mac"` on
  error.
- **Hash**: `sha2::Sha256` (the `sha2` Rust crate,
  v0.10). Already a transitive dep of `gix`; we
  depend directly for module self-containment.
- **Hex encoding**: a tiny inlined `hex_lower`
  function (we don't add the `hex` crate for one
  function).

The three fallback values ("unknown-host", "unknown-mac")
mean that an error in any of the three lookups still
produces a fingerprint, just a less-unique one. The
fingerprints are then consistent (the same machine
with the same broken hostname lookup gets the same
fingerprint across calls), so the licensing layer
still works.

## The threat model

- **A user who wants to share a license with a friend**
  would need to convince the friend to set their
  hostname, username, AND MAC to match. The friend
  can do this (on Linux, the MAC is
  `ip link set dev eth0 address …`), but it's
  a deliberate, detectable change. The friend
  also has to set their hostname and username
  to match, which means they have to be
  using a different account on a different
  machine, both of which are renamed to
  match the original. This is the same
  threat model as JetBrains / Sublime;
  the friend has to deliberately spoof.

- **A user who clones a VM** keeps the same
  fingerprint (the VM's hostname, username,
  and MAC are the same as the host's after
  a clean clone, or different if the user
  customized them). This is acceptable
  for the v1 threat model (the same as
  Sublime / BBEdit). A future "v2"
  license format with a `subs: string[]`
  field could allow "one license, up to
  N machines" without VM-detection.

- **A user who changes their hostname
  or username** (e.g. gets married and
  changes their last name) changes their
  fingerprint. The license is invalidated;
  the user has to email the project lead
  for a new license. This is rare but
  expected.

## What this decision does NOT do

- It does NOT defend against VM cloning.
  A cloned VM has the same fingerprint as
  the host; the license is shared. (See
  the "v2 license format" note above for
  a future improvement.)

- It does NOT defend against deliberate
  hostname / username / MAC spoofing.
  A user who deliberately sets all three
  to match another machine can share a
  license. The threat is bounded by the
  effort required (deliberate, detectable).

- It does NOT use the OS-provided machine
  ID. The three-input hash is more portable
  (one code path works on all three OSes)
  and less fragile (no dependence on
  `/etc/machine-id` being present, etc.).

## References

- `HANDOFF §9.24` — the per-phase writeup of Phase 2.
- `docs/plans/prod-p2-licensing-design.md` — the
  full design doc, including the threat model
  and the JWS-style serialization details.
- `docs/decisions/0085-p2-offline-license-validation.md`
  — the parent decision (offline-only verification).
  This decision is a sub-decision: given that
  verification is offline-only, the license is
  bound to a machine fingerprint; this ADR
  defines that fingerprint.
