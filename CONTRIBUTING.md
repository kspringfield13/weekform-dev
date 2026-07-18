# Contributing

ClearCapacity is an early prototype. Contributions should preserve user control, explainability, and conservative handling of work metadata.

## Development Setup

```bash
npm install
npm run dev
```

For native macOS functionality:

```bash
npm run desktop:dev
```

Optional AI features require `OPENAI_API_KEY`. Copy `.env.example` to `.env`, add the key locally, and restart the desktop app. Never commit credentials, local work data, calendar exports, screenshots, or generated build artifacts.

## Before Opening a Pull Request

Run:

```bash
npm run build
npm audit --audit-level=moderate
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Explain:

- what changed and why
- any privacy or data-flow impact
- how the change was validated
- any remaining limitations

## Project Guidelines

- Keep raw collection local unless the user explicitly invokes or enables a documented network feature.
- Make capture and sharing behavior visible and reversible.
- Prefer deterministic, reviewable calculations for capacity metrics.
- Treat model output as a draft that requires user review.
- Avoid adding new telemetry or persistence without documenting it.
- Add focused tests when changing parsing, inference, or capacity behavior.

## Issues

Use public issues for reproducible bugs and scoped feature proposals. Remove company names, customer information, credentials, personal data, window titles, and calendar details from examples.

For security or privacy vulnerabilities, use private security reporting rather than a public issue when the repository supports it.
