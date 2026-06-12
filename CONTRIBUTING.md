# Contributing to Lipi

Welcome. Before you do anything, read both:

1. **[`HANDOFF.md`](./HANDOFF.md)** — the *what* and *why*. Architectural
   decisions, phased plan, current state, hard constraints.
2. **[`docs/ENGINEERING.md`](./docs/ENGINEERING.md)** — the *how*. The 7
   engineering rules every change must follow (alignment, screen folders,
   component reuse, scalability defaults, etc.).

These two docs are the source of truth. Don't re-derive context — it's all
there.

## Ground rules

1. **Read both `HANDOFF.md` and `docs/ENGINEERING.md` first.** Don't re-derive
   context. Every decision, every phase, every constraint is documented there.
2. **Never install toolchains without owner confirmation.** This is in HANDOFF
   Section 7. The build was paused before Rust / Tauri CLI / Xcode / Android
   Studio were installed. If your work needs any of them, ask first.
3. **Never touch `C:\Users\Pv Vimal Nair\lifeof\`.** That is a separate Flutter
   project. Lipi lives only in `C:\Users\Pv Vimal Nair\lipi\`.
4. **Follow the phases in order.** No skipping ahead. Phase 5 (AI) does not
   start until Phase 2 (editor) works.
5. **Phase-by-phase verification.** End of each phase, stop and show a working
   result before moving on.
6. **Use `npm`, not pnpm / yarn / bun.** The handoff is explicit. Don't add
   lockfiles for other package managers.

## Coding conventions

- **TypeScript:** strict mode. No `any` without a comment explaining why.
- **Components:** PascalCase. One component per file. Single responsibility.
  Extract repeated UI; never nest more than 4 levels deep.
- **Variables / functions:** camelCase. Constants UPPER_SNAKE_CASE.
- **CSS:** use the design tokens in `src/styles/tokens.css`. No raw hex
  inside components. No hardcoded screen dimensions — use `useViewport` or
  CSS `min/max-width` queries.
- **Spacing scale:** 4, 8, 12, 16, 24, 32, 48. Use these values; don't eyeball.
- **Fonts:** weights 400 / 500 / 600 / 700 only. Line height always explicit.
- **Touch targets:** minimum 44x44 px.
- **Images:** always provide an error fallback.

## Pull request flow

1. Fork the repo and create a feature branch.
2. Make your change with focused commits.
3. Run `npm run typecheck` and `npm run build` locally — both must pass.
4. Open a PR with a short description and a screenshot if the change is
   visual.
5. Reference the HANDOFF phase your change advances.

## Reporting issues

- Search existing issues first.
- Include OS, version, and a minimal reproduction.
- If the issue is a Tauri / platform-specific build problem, tag it with the
  platform label.

## License

By contributing, you agree that your contributions are licensed under the
project's MIT license.
