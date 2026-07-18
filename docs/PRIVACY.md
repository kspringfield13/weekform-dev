# Privacy and Data Flow

ClearCapacity processes potentially sensitive work metadata. This document describes the current prototype behavior so users and contributors can evaluate it accurately.

## Local Data

The desktop app can collect:

- foreground application name
- front-window title
- capture timestamp
- locally imported Outlook calendar metadata
- user corrections, exclusions, and confirmations
- derived activity sessions, work blocks, forecasts, and narratives
- an audit trail of collection and review events

This data is stored in the Tauri webview's local storage. It is not currently encrypted by ClearCapacity and remains on the local macOS user account until the user resets prototype data or clears the application's webview storage.

## OpenAI API Data

AI features require `OPENAI_API_KEY`, normally configured in the repository's ignored `.env` file for local development. ClearCapacity loads this file into the native desktop process at startup; the key is not exposed through the Vite browser bundle. When an AI feature runs, ClearCapacity sends the prompt context required by that feature to the OpenAI Responses API. Classification, review suggestions, and forecasts are user-triggered; weekly narrative generation can run automatically after workload evidence exists.

Depending on the feature, prompt context can include:

- active-window app names and window titles
- grouped session timestamps and evidence
- work-block labels and confidence
- calendar-derived meeting metadata
- user corrections
- capacity snapshots
- manager-summary context

Requests set `store: false`. Users should still avoid enabling or invoking AI features when the included work metadata is not permitted to leave their device or organization.

## Visual Context

Visual context is disabled by default and must be enabled in Setup.

When enabled, the app may:

1. Capture the current macOS screen after a sustained activity session.
2. Write the image to a temporary PNG.
3. Read and encode the image for an OpenAI API request.
4. Delete the temporary local file.
5. Store only the derived text insight and audit metadata locally.

The screenshot can include content outside the active application because the prototype captures the current screen. Do not enable this feature around confidential, regulated, personal, or otherwise sensitive material.

## Controls

- **Private mode / Pause Tracking** stops new active-window and visual-context capture.
- **Visual Context** can be enabled or disabled independently.
- **Exclude** removes a work block from the reviewed workload model.
- **Reset Prototype Data** clears the app's persisted prototype state.

## Not Collected

The current implementation does not intentionally collect:

- keystrokes
- webcam or microphone input
- file contents
- email bodies
- meeting notes
- browser page bodies

Window titles and screenshots can nevertheless reveal some of this information indirectly. Treat both as sensitive.

## Reporting Privacy Issues

Do not include real credentials, private screenshots, customer data, or confidential work metadata in a public GitHub issue. Report a vulnerability through GitHub's private security reporting feature when it is available for the repository.
