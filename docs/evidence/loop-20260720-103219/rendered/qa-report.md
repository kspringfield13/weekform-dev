# Weekform Web Individual rendered QA report

| Field | Value |
| --- | --- |
| Date | 2026-07-20 |
| Mission | `loop-20260720-103219-8d922a` |
| Scope | Independent rendered QA of the Web Individual workspace: Today, Week, Agent, History, and Settings |
| Intended target | `http://localhost:3000/app` |
| Result | **BLOCKED before first render; no parity claim** |

## Outcome

No authenticated or demo-accessible Web Individual route could be rendered from this managed QA environment. The blocker occurs before application authentication and before any Weekform page code can be exercised:

1. An existing Node listener appeared on TCP port 3000, but HTTP probes to `127.0.0.1`, `localhost`, and `::1` could not connect.
2. Starting an isolated Next.js server on `127.0.0.1:3010` failed with `listen EPERM: operation not permitted`.
3. The required `agent-browser` workflow could not start its browser daemon. With the socket directory moved to writable `/tmp`, it still exited during startup without browser output. `agent-browser doctor --json` independently reported `launch.daemon` failure.
4. The in-app browser fallback reported `No browser is available`.

Because there was no reachable render, this report intentionally contains no fabricated screenshots, no pixel-parity verdict, and no claim that console checks passed.

## Route matrix

| Individual surface | Intended exercise | Rendered status | Evidence status |
| --- | --- | --- | --- |
| Today | Open primary Today view; inspect layout, states, and interactions | Not reached | Environment-blocked |
| Week / Capacity | Open Week overview/capacity view | Not reached | Environment-blocked |
| Week / Forecast | Switch to Forecast | Not reached | Environment-blocked |
| Week / AI Usage | Switch to AI Usage | Not reached | Environment-blocked |
| Week / Summary | Switch to Summary | Not reached | Environment-blocked |
| Agent / Ask | Open Agent Ask workspace | Not reached | Environment-blocked |
| Agent / Accelerate | Switch to Accelerate | Not reached | Environment-blocked |
| Agent / Skills | Switch to Skills Library | Not reached | Environment-blocked |
| History / Activity | Open Activity history | Not reached | Environment-blocked |
| History / Audit | Switch to Audit | Not reached | Environment-blocked |
| Settings | Open Settings and exercise panel navigation | Not reached | Environment-blocked |
| Browser console | Inspect errors/warnings on every route | Not reached | No console attached |
| Matched screenshots | Capture Individual route screenshots for Desktop comparison | Not reached | No screenshots produced |

## Reproduction evidence

### Local server probe

Command:

```bash
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/app
```

Observed:

```text
curl: (7) Failed to connect to localhost port 3000 after 0 ms: Couldn't connect to server
000
```

Equivalent probes against `127.0.0.1:3000` and `[::1]:3000` also returned connection failure.

### Isolated server start

Command:

```bash
npm --prefix apps/web run dev -- --hostname 127.0.0.1 --port 3010
```

Observed:

```text
Failed to start server
Error: listen EPERM: operation not permitted 127.0.0.1:3010
```

### Required browser harness

Command sequence:

```bash
AGENT_BROWSER_SOCKET_DIR=/tmp/ab-sockets agent-browser doctor --offline --quick --json
AGENT_BROWSER_SOCKET_DIR=/tmp/ab-sockets agent-browser --debug --session wf open http://localhost:3000/app
```

The offline environment checks passed, but the browser command returned:

```text
Daemon process exited during startup with no error output.
```

The full doctor check separately classified `launch.daemon` as failed. A supported in-app-browser fallback was also attempted and returned `No browser is available`.

## Findings

No application defect is asserted from these results. The only confirmed issue is an **environment-level proof blocker**: this worker cannot bind or reach the local Web server and cannot launch or attach a supported browser. Authentication status was therefore never reached and cannot be described as passing or failing.

## Exact rerun needed at the operator gate

Run from a host session that can bind localhost and launch Chrome:

1. Start `npm --prefix apps/web run dev` and confirm `/app` responds.
2. Use an authenticated Individual account, or a repository-supported synthetic/demo access path if one is visibly offered.
3. Capture matched screenshots at one fixed desktop viewport for Today; all Week subviews; all Agent subviews; History Activity/Audit; and every Settings panel.
4. Exercise tab switches, browser Back/Forward, refresh/deep-link restoration, keyboard focus, empty/loading/error states, and one safe interaction per page.
5. Record `agent-browser errors` and `agent-browser console` after every route.
6. Compare those captures against current Desktop renders before making a pixel-parity or operational-parity claim.

## QA decision

**NOT VERIFIED / BLOCKED.** This evidence does not satisfy authenticated rendered proof or matched-screenshot acceptance. Human approval should remain gated until the rerun above produces inspectable screenshots and clean console evidence.
