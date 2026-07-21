# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Weekform is a local-first macOS menu-bar app (Tauri 2 + React 18 + Vite) that turns consented local signals into reviewable work blocks and runs a deterministic model to show where the week went and how much new work fits. `apps/web` is the weekform.dev marketing/auth/team site (Next.js 16 + Supabase, deployed to Vercel).

## Commands

- **Done-gate: `npm run build`** (tsc -b + pricing check + vite build). Run it before considering any change complete. There is no single `npm test`.
- Targeted tests when touching that area: `test:simulator`, `test:cloud`, `test:desktop-cloud`, `test:web` (Node built-in runner via tsx); `test:supabase:rls` (needs local Supabase).
- Rust changes: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- Dev: `npm run dev` (webview only, port 5173), `npm run demo` (synthetic data), `npm run desktop:dev` (full Tauri app). Web app: `npm --prefix apps/web run dev` / `build` / `typecheck`.
- Use **npm**, not pnpm (`pnpm-workspace.yaml` is a non-functional stub).
- Lint: `npm run lint` (Biome, lint-only — no formatter). Pre-existing issues are demoted to warnings in biome.json; keep new code free of errors and don't add to the warning count. Match existing style: 2-space indent, double quotes, semicolons. AGENTS.md's claim that no lint script exists is stale.

## Layout

- `apps/desktop/` — Tauri app: `src/` (React), `src-tauri/` (Rust shell + native commands)
- `apps/web/` — Next.js site with its own package.json/lockfile
- `packages/domain|inference|integrations|simulator/` — shared TS, compiled in place via root tsconfig (no build step); tests colocated as `.test.ts`
- `supabase/` — dated SQL migrations, seed, RLS tests

## Product invariants (condensed from AGENTS.md — read it for depth)

- Local-first: user data stays on device; cloud sync is opt-in and Supabase access uses the anon key only — authorization lives in RLS, never a service key in the desktop app.
- The capacity/forecast core is deterministic; AI assists but never silently mutates data. Actions are approval-gated.
- Window titles, screenshots, and chat contents are sensitive: never log them, commit them, or send them anywhere unapproved. OpenAI requests keep `store: false`.
- Public/demo data must be synthetic.

## Gotchas

- Dev port 5173 is hardcoded in both `vite.config.ts` and `apps/desktop/src-tauri/tauri.conf.json` — change both or neither.
- Legacy `clear-capacity.*` storage keys and the `com.clearcapacity.desktop` bundle id must be preserved; migrate only with rollback.
- AGENTS.md's claim that the repo has no tests is stale — the `test:*` scripts above are real.

## Etiquette

- Short, imperative commit messages; one coherent outcome per commit; commit directly to `main`.
