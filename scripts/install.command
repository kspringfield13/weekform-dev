#!/usr/bin/env bash
#
# ClearCapacity — friendly one-shot installer for macOS.
#
# This is meant to be handed to a non-developer: double-click it in Finder
# (it has the .command extension so Terminal opens it), or run it from a
# terminal with `bash scripts/install.command`. It walks through everything
# needed to get the desktop app onto the Mac:
#
#   1. Confirms this is macOS.
#   2. Locates the project (or clones it if the script was run on its own).
#   3. Installs the prerequisites it can't find — Xcode Command Line Tools,
#      Homebrew, Node.js, and the Rust toolchain — asking before each one.
#   4. Builds the desktop app and copies ClearCapacity.app into /Applications.
#   5. Explains the macOS Accessibility prompt and opens the app.
#
# Nothing here is destructive: every install step is opt-in, and the only
# thing written outside the project is /Applications/ClearCapacity.app.
#
# Non-interactive use (CI, scripted installs): set CLEAR_CAPACITY_YES=1 to
# auto-accept every prompt.

set -euo pipefail

# ---------------------------------------------------------------------------
# Pretty output helpers
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; CYAN=""; RESET=""
fi

STEP=0
TOTAL=7
ASSUME_YES="${CLEAR_CAPACITY_YES:-0}"
REPO_URL="https://github.com/kspringfield13/clear-capacity.git"

step()  { STEP=$((STEP + 1)); printf "\n${BOLD}${BLUE}[%d/%d] %s${RESET}\n" "$STEP" "$TOTAL" "$1"; }
info()  { printf "      ${DIM}%s${RESET}\n" "$1"; }
ok()    { printf "      ${GREEN}✓ %s${RESET}\n" "$1"; }
warn()  { printf "      ${YELLOW}! %s${RESET}\n" "$1"; }
die()   { printf "\n${RED}✗ %s${RESET}\n" "$1" >&2; exit 1; }

# Ask a yes/no question. Defaults to yes. Honors CLEAR_CAPACITY_YES=1.
confirm() {
  local prompt="$1"
  if [ "$ASSUME_YES" = "1" ]; then return 0; fi
  printf "      ${CYAN}%s${RESET} [Y/n] " "$prompt"
  local reply
  read -r reply </dev/tty || reply=""
  case "$reply" in
    [nN]*) return 1 ;;
    *) return 0 ;;
  esac
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
clear 2>/dev/null || true
cat <<BANNER
${BOLD}${CYAN}
   ____ _                 ____                       _ _
  / ___| | ___  __ _ _ __/ ___|__ _ _ __   __ _  ___(_) |_ _   _
 | |   | |/ _ \\/ _\` | '__| |   / _\` | '_ \\ / _\` |/ __| | __| | | |
 | |___| |  __/ (_| | |  | |__| (_| | |_) | (_| | (__| | |_| |_| |
  \\____|_|\\___|\\__,_|_|   \\____\\__,_| .__/ \\__,_|\\___|_|\\__|\\__, |
                                    |_|                     |___/
${RESET}
  ${DIM}Local-first workload intelligence for macOS — installer${RESET}

  This will set up everything ClearCapacity needs and place the app in
  your Applications folder. It may ask for your password when installing
  system tools, and it only installs things that are missing.
BANNER

if ! confirm "Ready to begin?"; then
  info "No problem — run this again whenever you're ready."
  exit 0
fi

# ---------------------------------------------------------------------------
# 1. Confirm macOS
# ---------------------------------------------------------------------------
step "Checking your system"
if [ "$(uname -s)" != "Darwin" ]; then
  die "ClearCapacity is a macOS app. This installer only runs on macOS."
fi
ok "Running on macOS $(sw_vers -productVersion 2>/dev/null || echo "")"

# ---------------------------------------------------------------------------
# 2. Locate (or clone) the project
# ---------------------------------------------------------------------------
step "Finding the ClearCapacity project"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR=""

# If the script sits in <repo>/scripts/, the repo root is one level up.
if [ -f "$SCRIPT_DIR/../package.json" ] && grep -q '"clear-capacity"' "$SCRIPT_DIR/../package.json" 2>/dev/null; then
  PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  ok "Found the project at $PROJECT_DIR"
else
  # Script was run on its own — offer to clone a fresh copy.
  PROJECT_DIR="$HOME/clear-capacity"
  if [ -d "$PROJECT_DIR/.git" ]; then
    ok "Using existing checkout at $PROJECT_DIR"
  else
    info "The project isn't here yet."
    if ! command -v git >/dev/null 2>&1; then
      die "git is required to download the project. Install Xcode Command Line Tools first (xcode-select --install) and re-run."
    fi
    if confirm "Download ClearCapacity into $PROJECT_DIR?"; then
      git clone "$REPO_URL" "$PROJECT_DIR"
      ok "Downloaded the project to $PROJECT_DIR"
    else
      die "Nothing to build. Re-run this from inside the project folder."
    fi
  fi
fi
cd "$PROJECT_DIR"

# ---------------------------------------------------------------------------
# 3. Xcode Command Line Tools (provides git, clang, and build headers)
# ---------------------------------------------------------------------------
step "Checking Xcode Command Line Tools"
if xcode-select -p >/dev/null 2>&1; then
  ok "Command Line Tools are installed"
else
  warn "Command Line Tools are missing — macOS will pop up an installer."
  if confirm "Trigger the Command Line Tools install now?"; then
    xcode-select --install || true
    info "Finish the macOS install dialog, then press Return here to continue."
    read -r _ </dev/tty || true
    xcode-select -p >/dev/null 2>&1 || die "Command Line Tools still not detected. Install them, then re-run this script."
    ok "Command Line Tools are installed"
  else
    die "Command Line Tools are required to build the app."
  fi
fi

# ---------------------------------------------------------------------------
# 4. Homebrew (used to install Node and Rust if they're missing)
# ---------------------------------------------------------------------------
step "Checking package tools (Homebrew, Node, Rust)"

ensure_brew() {
  if command -v brew >/dev/null 2>&1; then
    ok "Homebrew is installed"
    return 0
  fi
  warn "Homebrew (the macOS package manager) is not installed."
  if confirm "Install Homebrew? It's the easiest way to get Node and Rust."; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Make brew available on Apple Silicon and Intel for the rest of this run.
    if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
    if [ -x /usr/local/bin/brew ]; then eval "$(/usr/local/bin/brew shellenv)"; fi
    command -v brew >/dev/null 2>&1 && ok "Homebrew installed" || die "Homebrew install did not complete."
    return 0
  fi
  return 1
}

# --- Node.js 20+ ---
node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+)\..*/\1/'; }
if command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge 20 ] 2>/dev/null; then
  ok "Node.js $(node -v) is installed"
else
  if command -v node >/dev/null 2>&1; then
    warn "Node.js $(node -v) is too old — version 20 or newer is required."
  else
    warn "Node.js is not installed."
  fi
  if ensure_brew && confirm "Install Node.js via Homebrew?"; then
    brew install node
    ok "Node.js $(node -v) installed"
  else
    die "Node.js 20+ is required. Install it from https://nodejs.org and re-run."
  fi
fi

# --- Rust toolchain ---
if command -v cargo >/dev/null 2>&1; then
  ok "Rust toolchain is installed ($(rustc --version 2>/dev/null || echo cargo present))"
else
  warn "The Rust toolchain is not installed (needed to compile the native app)."
  if confirm "Install Rust via rustup?"; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # shellcheck disable=SC1091
    [ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
    command -v cargo >/dev/null 2>&1 && ok "Rust installed" || die "Rust install did not complete. Open a new terminal and re-run."
  else
    die "The Rust toolchain is required to build the desktop app."
  fi
fi

# ---------------------------------------------------------------------------
# 5. Install JS dependencies + optional AI key
# ---------------------------------------------------------------------------
step "Installing project dependencies"
npm install
ok "Dependencies installed"

if [ ! -f .env ]; then
  cp .env.example .env 2>/dev/null || true
  info "Optional: AI features (forecasts, summaries, the agent) need an API key."
  if confirm "Add an OpenAI API key now? (you can also do this later in Settings)"; then
    printf "      Paste your key (it stays only in this project's .env): "
    read -r api_key </dev/tty || api_key=""
    if [ -n "$api_key" ]; then
      # Replace or append OPENAI_API_KEY without echoing the key back.
      if grep -q '^OPENAI_API_KEY=' .env 2>/dev/null; then
        tmp="$(mktemp)"; grep -v '^OPENAI_API_KEY=' .env > "$tmp"; mv "$tmp" .env
      fi
      printf 'OPENAI_API_KEY=%s\n' "$api_key" >> .env
      ok "API key saved to .env"
    else
      info "Skipped — the app works without AI; add a key in Settings anytime."
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 6. Build the desktop app
# ---------------------------------------------------------------------------
step "Building the desktop app (this can take a few minutes the first time)"
info "Compiling the Rust shell and the interface…"
# CARGO_BUILD_JOBS keeps memory in check on smaller Macs; remove for max speed.
CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}" npm run desktop:build
ok "Build complete"

APP_PATH="$(find apps/desktop/src-tauri/target/release/bundle/macos -maxdepth 1 -name 'ClearCapacity.app' -print -quit 2>/dev/null || true)"
[ -n "$APP_PATH" ] || die "Could not find the built app. Check the build output above for errors."

# ---------------------------------------------------------------------------
# 7. Install into /Applications
# ---------------------------------------------------------------------------
step "Installing ClearCapacity into your Applications folder"
DEST="/Applications/ClearCapacity.app"
if [ -d "$DEST" ]; then
  info "Replacing the previous version."
  rm -rf "$DEST"
fi
cp -R "$APP_PATH" "$DEST"
# This build isn't signed by an Apple Developer account, so macOS quarantines
# it. Clearing the flag lets it open without the "unidentified developer"
# block. (Safe here: you built this app yourself from source moments ago.)
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
ok "Installed to $DEST"

# ---------------------------------------------------------------------------
# Done — explain permissions and open the app
# ---------------------------------------------------------------------------
cat <<DONE

${BOLD}${GREEN}✓ All set!${RESET} ClearCapacity is in your Applications folder.

${BOLD}One more thing — the first launch:${RESET}
  • ClearCapacity lives in the ${BOLD}menu bar${RESET} (top-right), not the Dock.
    Click its icon to open the main window.
  • macOS will ask for ${BOLD}Accessibility${RESET} permission. This lets the app
    see which app is in the foreground (never your keystrokes or screen).
    Approve it in System Settings → Privacy & Security → Accessibility.
  • A short ${BOLD}in-app walkthrough${RESET} will point out where everything is.

  Everything stays on this Mac. AI features are optional and opt-in.

DONE

if confirm "Open ClearCapacity now?"; then
  open "$DEST"
fi

info "Enjoy! Re-run this script anytime to update to a newer build."
