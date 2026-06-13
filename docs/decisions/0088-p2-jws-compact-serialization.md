# ADR #88 — Phase 2: the license key is a JWS-style compact serialization (`LIP1.<base64url(payload)>.<base64url(signature)>`) using Ed25519

**Date**: June 2026
**Phase**: 2 of the production-readiness roadmap (Offline licensing layer)
**Status**: Accepted
**Supersedes**: n/a (this is the first licensing decision in the project's history)
**Deciders**: project lead (Vimal Nair)

## Context

Phase 2 ships an offline-license system (Decision #85). The
license key is what the user pastes into the app's
activation screen. The key is verified offline by the
Rust side (the public key is embedded).

The question is: **what's the wire format of the license key?**

The key is a string (the user pastes it into a textarea,
the app reads it, the app parses it). The string needs
to be:

1. **Self-contained.** A single string contains the
   payload + the signature + any framing metadata
   (format identifier, version marker). The user
   pastes ONE thing; the app extracts everything
   from that one string.
2. **Copy-pasteable.** The user copies the key from
   an email / the App Store receipt / a website
   and pastes it into a textarea. The format
   must survive copy-paste (no newlines in the
   middle, no special characters that get
   mangled, no leading/trailing whitespace
   issues).
3. **Standard.** A user (or the project lead, or
   a future "verify this key" CLI tool) can use
   standard libraries to verify the signature.
   The format should not be a Lipi-proprietary
   invention; it should be a recognized standard.
4. **Versionable.** A future v2 license format
   (e.g. with a `subs: string[]` field for
   team licenses, or a `features: string[]`
   field for feature flags) can be introduced
   without breaking v1 parsers.

The two main options for the format are:

- **JWS compact serialization (RFC 7515).** A
  three-part string:
  `<header>.<payload>.<signature>`, where each
  part is base64url-encoded (no padding). The
  header is JSON (typically `{"alg": "EdDSA",
  "typ": "JWT"}`); the payload is JSON; the
  signature is the raw bytes (Ed25519 = 64 bytes).
- **Custom serialization.** A Lipi-proprietary
  format, e.g. `LIP1.<base64url(json_payload)>.<base64url(signature)>`.
  Same shape as JWS compact, but with a Lipi-
  specific "header" string (e.g. "LIP1" instead
  of the JSON `{"alg": "EdDSA", "typ": "JWT"}`).

The standard JWS form has the advantage of being
verifiable by any standard library (`jose` CLI,
`jwt.io` web tool, etc.). The custom form has
the advantage of being Lipi-specific (the user
knows at a glance that this is a Lipi license,
not a generic JWT), and of being versionable
without depending on the JOSE header
structure.

## The options considered

1. **Standard JWS compact serialization (RFC 7515).**
   The key is `<base64url(header)>.<base64url(payload)>.<base64url(signature)>`.
   The header is `{"alg": "EdDSA", "typ": "LIPI"}` or
   similar. The payload is the LicensePayload JSON.
   The signature is the Ed25519 signature over
   `<header>.<payload>`.

   **Selected against (with a small modification,
   see option 3).** The standard form is
   verifiable by any standard library, which
   is good. But the standard form is also
   ambiguous: a user who pastes a JWS into
   a generic JWT verifier sees a JWT, not a
   Lipi license. A "is this a Lipi license?"
   check requires parsing the payload and
   looking for the `format: "lipi-license-v1"`
   field. The lack of a "Lipi" prefix makes
   the format less discoverable.

2. **Fully custom Lipi-proprietary format.**
   The key is `LIP1.<base64url(json_payload)>.<base64url(signature)>`.
   No JSON header; the "LIP1" prefix is the
   version marker. The payload's `format` field
   (`"lipi-license-v1"`) is the in-payload
   version marker. The signature is the Ed25519
   signature over `LIP1.<base64url(json_payload)>`.

   **Selected against.** The "no JSON header"
   choice is fine, but a fully custom format
   means a user (or a future CLI tool) can't
   use standard libraries to verify the
   signature. They'd have to use the Lipi
   sign-license CLI or implement the
   Ed25519 verification themselves. The
   "verifiable by standard tools"
   property is worth keeping.

3. **JWS compact with a Lipi-specific header.**
   The key is `<base64url(header)>.<base64url(payload)>.<base64url(signature)>`
   where the header is `{"alg": "EdDSA", "typ": "LIPI", "kid": "lipi-v1"}`
   or similar. The `typ: "LIPI"` field is the
   Lipi-specific marker. The signature is the
   standard JWS signature over
   `<header>.<payload>`.

   **Selected against (close to option 4).**
   The JOSE `typ` header is intended for
   media-type identification (e.g. `"typ": "JWT"`),
   and using it for a Lipi-specific marker is
   a slight misuse. A future "is this a Lipi
   license?" check would still need to look
   at the payload (the `format` field).

4. **JWS-style with a Lipi-specific prefix instead
   of a JSON header.** The key is
   `LIP1.<base64url(json_payload)>.<base64url(signature)>`.
   The "LIP1" is the "header" (a string literal
   instead of a JSON object); the rest is identical
   to JWS compact. The payload's `format` field
   (`"lipi-license-v1"`) is the in-payload
   version marker. The signature is the Ed25519
   signature over `LIP1.<base64url(json_payload)>`.

   **Selected.** The format is "JWS compact
   shape, with a Lipi-specific string
   literal as the header instead of a
   JSON object". The "LIP1" prefix is a
   version marker (a future v2 license
   format would use "LIP2"). The
   signature is computed over the same
   `<header>.<payload>` byte string as
   standard JWS; the only difference is
   that the "header" is a string, not a
   JSON object. The verification path
   is identical to a standard JWS verify
   (parse the three parts, decode the
   signature, verify against
   `<header>.<payload>`); a user with a
   standard JWS library can verify a
   Lipi license by replacing the JSON
   header with the "LIP1" string in
   the signing input.

## The decision

**JWS-style compact serialization with a
Lipi-specific prefix:**

```
LIP1.<base64url(json_payload)>.<base64url(signature)>
```

Where:

- `LIP1` is a string literal (the "header"
  in JWS terms). The byte string
  `LIP1.<base64url(json_payload)>` is the
  "signing input" (the JWS "signing input"
  is `<header>.<payload>`; the only
  difference is the header is a string
  literal, not a base64url-encoded JSON
  object).
- `<base64url(json_payload)>` is the
  base64url (no padding) encoding of the
  LicensePayload JSON. The JSON is
  compact (no whitespace, no
  indentation) for canonical byte
  representation.
- `<base64url(signature)>` is the
  base64url (no padding) encoding of
  the 64-byte Ed25519 signature.
- The signature is the Ed25519
  signature (RFC 8032) over the
  byte string `LIP1.<base64url(json_payload)>`.
  The same Ed25519 key is used for
  signing and verification;
  the production private key signs
  paid licenses, the trial private
  key signs trial licenses.

A real key looks like:

```
LIP1.eyJmb3JtYXQiOiJsaXBpLWxpY2Vuc2UtdjEiLCJwbGFuIjoieWVhcmx5IiwiaWF0IjoxNzE4MTI4MDAwLCJuYmYiOjE3MTgxMjgwMDAsImV4cCI6MTc0OTY2NDAwMCwic3ViIjoiYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSIsImp0aSI6IjAxMjM0NTY3ODlhYmNkZWYifQ.AAAA...64-bytes-of-signature...AAAA
```

(The signature part is base64url-encoded 64
bytes, so it's ~86 chars. The total key length
is ~400-500 chars.)

## The trade-offs

**What we gain:**

- **Verifiable by standard tools.** A user with
  a standard JWS library can verify the
  signature by treating the "LIP1" string
  as the header (replacing the JSON
  header in the signing input). The
  `jose` CLI, for example, can verify a
  Lipi license with a one-line
  workaround.

- **Discoverable.** A user who sees a
  `LIP1.…` key knows at a glance that
  this is a Lipi license, not a
  generic JWT. The "LIP1" prefix
  is greppable, copy-pasteable, and
  unmistakable.

- **Versionable.** A future v2 license
  format (e.g. with a `subs: string[]`
  field for team licenses) uses
  `LIP2.…` as the prefix. The v1
  parser rejects `LIP2.…` keys; the
  v2 parser handles both.

- **Compact.** A 400-500 char key is
  copy-pasteable into a single
  textarea line (with wrapping in
  most textareas). A 1KB key would
  be unwieldy; a 100-byte key would
  be too small for the payload +
  signature + framing.

**What we lose:**

- **Not a "real" JWS.** A user who
  pastes a Lipi license into a
  generic JWT verifier sees a parse
  error (the "header" is a string,
  not a base64url-encoded JSON
  object). The workaround is one
  line (replace the JSON header
  with the "LIP1" string in the
  signing input), but it's not
  zero-work.

- **The "LIP1" prefix is Lipi-specific.**
  A future "Lipi license standard"
  effort (unlikely, but possible)
  would have to negotiate the
  prefix. For now, the prefix is
  fine.

## The version marker

The "LIP1" prefix is the wire-format version
marker. A future v2 license format (e.g. with
`subs: string[]` for team licenses) would use
"LIP2". The payload's `format` field is the
in-payload version marker: v1 has
`format: "lipi-license-v1"`; a future v2 would
have `format: "lipi-license-v2"`. The two
markers are intentionally distinct:

- The prefix ("LIP1" / "LIP2") is the wire
  format version. It changes when the byte
  layout changes.
- The payload's `format` field
  ("lipi-license-v1" / "lipi-license-v2")
  is the in-payload schema version. It
  changes when the JSON schema changes.

A v1.5 license (a wire-format-compatible
change with a new payload field) would have
`LIP1.` prefix and `format: "lipi-license-v1.5"`
in the payload. A v2.0 license (a new wire
format and a new schema) would have
`LIP2.` prefix and `format: "lipi-license-v2.0"`.

## What this decision rules out

- A "fully standard" JWS with a JSON header.
  The "LIP1" prefix is preferred for
  discoverability.

- A "fully custom" format with no relation
  to JWS. The "verifiable by standard
  tools" property is worth keeping.

- A version-less format (no prefix, no
  `format` field). The version markers
  enable forward compatibility; dropping
  them would mean a v2 license format
  breaks v1 parsers (and vice versa).

## References

- `HANDOFF §9.24` — the per-phase writeup of Phase 2.
- `docs/plans/prod-p2-licensing-design.md` — the
  full design doc, including the threat model
  and the JWS-style serialization details.
- `docs/decisions/0085-p2-offline-license-validation.md`
  — the parent decision (offline-only verification).
  This decision is a sub-decision: given that
  verification is offline-only, the license key
  is a JWS-style compact serialization.
- RFC 7515 — JSON Web Signature (JWS).
- RFC 8032 — Edwards-curve Digital Signature
  Algorithm (EdDSA).
