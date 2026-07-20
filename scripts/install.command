#!/usr/bin/env bash
#
# Weekform — friendly one-shot installer for macOS.
#
# This is meant to be handed to a non-developer: double-click it in Finder
# (it has the .command extension so Terminal opens it), or run it from a
# terminal with `bash scripts/install.command`. It walks through everything
# needed to get the desktop app onto the Mac:
#
#   1. Confirms this is macOS.
#   2. Installs Xcode Command Line Tools if they are missing.
#   3. Locates the project (or clones it if the script was run on its own).
#   4. Installs any remaining prerequisites — Homebrew, Node.js, and Rust.
#   5. Installs locked dependencies and builds the desktop app.
#   6. Safely replaces Weekform.app and explains first-launch permissions.
#
# The app is written to /Applications/Weekform.app. Existing Weekform installs
# are replaced only after the user confirms the installer should run.
#
# Non-interactive use (CI, scripted installs): set WEEKFORM_YES=1 to
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
ASSUME_YES="${WEEKFORM_YES:-0}"
REPO_URL="https://github.com/kspringfield13/weekform-dev.git"

step()  { STEP=$((STEP + 1)); printf "\n${BOLD}${BLUE}[%d/%d] %s${RESET}\n" "$STEP" "$TOTAL" "$1"; }
info()  { printf "      ${DIM}%s${RESET}\n" "$1"; }
ok()    { printf "      ${GREEN}✓ %s${RESET}\n" "$1"; }
warn()  { printf "      ${YELLOW}! %s${RESET}\n" "$1"; }
die()   { printf "\n${RED}✗ %s${RESET}\n" "$1" >&2; exit 1; }

# Ask a yes/no question. Defaults to yes. Honors WEEKFORM_YES=1.
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
 __        __         _     __
 \\ \\      / /__  ___ | | __/ _| ___  _ __ _ __ ___
  \\ \\ /\\ / / _ \\/ _ \\| |/ / |_ / _ \\| '__| '_  _  \\
   \\ V  V /  __/  __/|   <|  _| (_) | |  | | | | | |
    \\_/\\_/ \\___|\\___||_|\\_\\_|  \\___/|_|  |_| |_| |_|
${RESET}
  ${DIM}Local-first workload intelligence for macOS — installer${RESET}

  This will set up everything Weekform needs and place the app in
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
  die "Weekform is a macOS app. This installer only runs on macOS."
fi
ok "Running on macOS $(sw_vers -productVersion 2>/dev/null || echo "")"

# ---------------------------------------------------------------------------
# 2. Xcode Command Line Tools (provides git, clang, and build headers)
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
    die "Command Line Tools are required to download and build the app."
  fi
fi

# ---------------------------------------------------------------------------
# 3. Locate (or clone) the project
# ---------------------------------------------------------------------------
step "Finding the Weekform project"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR=""

is_weekform_checkout() {
  local directory="$1"
  local required_file
  for required_file in \
    package.json \
    package-lock.json \
    index.html \
    tsconfig.json \
    vite.config.ts \
    apps/desktop/src/main.tsx \
    apps/desktop/src-tauri/Cargo.toml \
    apps/desktop/src-tauri/tauri.conf.json \
    packages/domain/src/models.ts \
    packages/domain/src/taxonomy.ts \
    packages/inference/src/capacity.ts \
    packages/inference/src/aiUsage.ts \
    packages/integrations/src/usage/model-prices.catalog.json \
    scripts/refresh-model-prices.mjs; do
    [ -s "$directory/$required_file" ] || return 1
  done
  grep -Eq '"weekform"' "$directory/package.json" 2>/dev/null &&
    grep -Eq '"desktop:build"' "$directory/package.json" 2>/dev/null
}

# If the script sits in <repo>/scripts/, the repo root is one level up.
if is_weekform_checkout "$SCRIPT_DIR/.."; then
  PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  ok "Found the project at $PROJECT_DIR"
elif [ -d "$SCRIPT_DIR/../.git" ]; then
  die "This Weekform checkout is incomplete: one or more required app, package, or build files are missing. Restore the complete source tree, then re-run this installer."
else
  # Script was run on its own — offer to clone a fresh copy.
  PROJECT_DIR="$HOME/weekform-dev"
  if [ -d "$PROJECT_DIR/.git" ]; then
    if is_weekform_checkout "$PROJECT_DIR"; then
      ok "Using existing checkout at $PROJECT_DIR"
    elif ! git -C "$PROJECT_DIR" rev-parse --verify HEAD >/dev/null 2>&1; then
      info "The existing checkout has no source commit; checking for a published main branch…"
      if git -C "$PROJECT_DIR" fetch --depth 1 origin main >/dev/null 2>&1 &&
        git -C "$PROJECT_DIR" checkout -B main FETCH_HEAD >/dev/null 2>&1 &&
        is_weekform_checkout "$PROJECT_DIR"; then
        ok "Downloaded the published Weekform source into $PROJECT_DIR"
      else
        die "The public Weekform repository does not have an installable main branch yet. Publish the complete source to $REPO_URL, then re-run this installer."
      fi
    else
      die "The existing checkout at $PROJECT_DIR is incomplete. Move it aside or restore its missing build files, then re-run this installer."
    fi
  else
    info "The project isn't here yet."
    if ! command -v git >/dev/null 2>&1; then
      die "git is required to download the project. Install Xcode Command Line Tools first (xcode-select --install) and re-run."
    fi
    if confirm "Download Weekform into $PROJECT_DIR?"; then
      if git clone --depth 1 "$REPO_URL" "$PROJECT_DIR" && is_weekform_checkout "$PROJECT_DIR"; then
        ok "Downloaded the project to $PROJECT_DIR"
      else
        die "The public Weekform repository does not contain a complete installable source tree yet. Publish all app, package, lockfile, and build inputs before this installer can continue."
      fi
    else
      die "Nothing to build. Re-run this from inside the project folder."
    fi
  fi
fi
is_weekform_checkout "$PROJECT_DIR" || die "Weekform's required build files are missing from $PROJECT_DIR."
cd "$PROJECT_DIR"

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

# --- Node.js version supported by Vite 8: 20.19+ or 22.12+ ---
node_version_supported() {
  command -v node >/dev/null 2>&1 || return 1
  command -v npm >/dev/null 2>&1 || return 1
  local version major minor
  version="$(node -p 'process.versions.node' 2>/dev/null)" || return 1
  IFS=. read -r major minor _ <<<"$version"
  [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] || return 1
  [ "$major" -eq 20 ] && [ "$minor" -ge 19 ] && return 0
  [ "$major" -eq 22 ] && [ "$minor" -ge 12 ] && return 0
  [ "$major" -gt 22 ]
}

if node_version_supported; then
  ok "Node.js $(node -v) is installed"
else
  if command -v node >/dev/null 2>&1; then
    warn "Node.js $(node -v) is unsupported — use Node 20.19+ or 22.12+."
  else
    warn "Node.js is not installed."
  fi
  if ensure_brew && confirm "Install Node.js via Homebrew?"; then
    brew install node
    node_version_supported || die "Homebrew installed Node.js, but the active node/npm commands are still unsupported. Open a new terminal and re-run."
    ok "Node.js $(node -v) installed"
  else
    die "Node.js 20.19+ or 22.12+ is required. Install it from https://nodejs.org and re-run."
  fi
fi

# --- Rust toolchain ---
if command -v cargo >/dev/null 2>&1 && command -v rustc >/dev/null 2>&1 &&
  cargo --version >/dev/null 2>&1 && rustc --version >/dev/null 2>&1; then
  ok "Rust toolchain is installed ($(rustc --version))"
else
  warn "The Rust toolchain is not installed (needed to compile the native app)."
  if confirm "Install Rust via rustup?"; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # shellcheck disable=SC1091
    [ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
    command -v cargo >/dev/null 2>&1 && command -v rustc >/dev/null 2>&1 &&
      cargo --version >/dev/null 2>&1 && rustc --version >/dev/null 2>&1 &&
      ok "Rust installed" || die "Rust install did not complete. Open a new terminal and re-run."
  else
    die "The Rust toolchain is required to build the desktop app."
  fi
fi

# ---------------------------------------------------------------------------
# 5. Install JS dependencies
# ---------------------------------------------------------------------------
step "Installing project dependencies"
is_weekform_checkout "$PROJECT_DIR" || die "The Weekform checkout became incomplete before dependency installation."
npm ci
ok "Dependencies installed"
info "OpenAI features are optional; add a key in Weekform Settings after launch."

# ---------------------------------------------------------------------------
# 6. Build the desktop app
# ---------------------------------------------------------------------------
step "Building the desktop app (this can take a few minutes the first time)"
info "Compiling the Rust shell and the interface…"
# CARGO_BUILD_JOBS keeps memory in check on smaller Macs; remove for max speed.
SELECTED_DEVELOPER_DIR="$(xcode-select -p)"
DEVELOPER_DIR="$SELECTED_DEVELOPER_DIR" CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}" npm run desktop:build
ok "Build complete"

EXPECTED_BUILD_APP="$PROJECT_DIR/apps/desktop/src-tauri/target/release/bundle/macos/Weekform.app"
APP_PATH="$(find "$PROJECT_DIR/apps/desktop/src-tauri/target/release/bundle/macos" -maxdepth 1 -name 'Weekform.app' -print -quit 2>/dev/null || true)"
[ -n "$APP_PATH" ] || die "Could not find the built app. Check the build output above for errors."
[ "$APP_PATH" = "$EXPECTED_BUILD_APP" ] || die "The build returned an unexpected app path; nothing was installed or removed."

# ---------------------------------------------------------------------------
# 7. Install into /Applications
# ---------------------------------------------------------------------------
step "Installing Weekform into your Applications folder"
INSTALL_DIR="/Applications"
if [ ! -w "$INSTALL_DIR" ]; then
  INSTALL_DIR="$HOME/Applications"
  mkdir -p "$INSTALL_DIR"
  warn "/Applications is not writable; installing for this user in $INSTALL_DIR instead."
fi

DEST="$INSTALL_DIR/Weekform.app"
STAGED_DEST="$INSTALL_DIR/.Weekform-installing-$$.app"
BACKUP_DEST="$INSTALL_DIR/.Weekform-previous-$$.app"

cp -R "$APP_PATH" "$STAGED_DEST"

if pgrep -x Weekform >/dev/null 2>&1; then
  info "Asking the running Weekform app to quit before replacement."
  osascript -e 'tell application "Weekform" to quit' >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5; do
    pgrep -x Weekform >/dev/null 2>&1 || break
    sleep 1
  done
  if pgrep -x Weekform >/dev/null 2>&1; then
    rm -rf "$STAGED_DEST"
    die "Weekform is still running. Quit it from the menu bar, then re-run the installer."
  fi
fi

if [ -d "$DEST" ]; then
  info "Replacing the previous version."
  mv "$DEST" "$BACKUP_DEST"
fi

if mv "$STAGED_DEST" "$DEST"; then
  [ ! -d "$BACKUP_DEST" ] || rm -rf "$BACKUP_DEST"
else
  [ ! -d "$BACKUP_DEST" ] || mv "$BACKUP_DEST" "$DEST"
  rm -rf "$STAGED_DEST"
  die "Could not replace the installed app; the previous version was restored."
fi

# This build isn't signed by an Apple Developer account, so macOS quarantines
# it. Clearing the flag lets it open without the "unidentified developer"
# block. (Safe here: you built this app yourself from source moments ago.)
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
if xattr -p com.apple.quarantine "$DEST" >/dev/null 2>&1; then
  warn "macOS kept the quarantine flag. If launch is blocked, right-click Weekform.app and choose Open."
fi
ok "Installed to $DEST"

# Keep one installed app. Tauri's source build also leaves the exact bundle it
# produced under target/release/bundle/macos; once the verified copy above is
# safely in Applications, that build output is redundant and confuses Finder.
[ "$APP_PATH" = "$EXPECTED_BUILD_APP" ] || die "The temporary build path changed unexpectedly; leaving it untouched."
rm -rf -- "$APP_PATH"
ok "Temporary build copy was removed"

# ---------------------------------------------------------------------------
# Done — explain permissions and open the app
# ---------------------------------------------------------------------------
cat <<DONE

${BOLD}${GREEN}✓ All set!${RESET} Weekform is in your Applications folder.

  The temporary build copy was removed. If you downloaded the source ZIP,
  its extracted source folder can be moved to Trash after Weekform opens.

${BOLD}One more thing — launching the app:${RESET}
  • Weekform opens its ${BOLD}full window${RESET} every time you launch it; the
    first launch adds a short welcome, a tour, and a quick setup.
  • Weekform also keeps its logo in the ${BOLD}menu bar${RESET} (top-right), not
    the Dock. Close the window anytime — click the icon to reopen it.
  • macOS will ask for ${BOLD}Accessibility${RESET} permission. This lets the app
    see which app is in the foreground (never your keystrokes or screen).
    Approve it in System Settings → Privacy & Security → Accessibility.
  • Optional visual context may also request ${BOLD}Screen Recording${RESET}; menu-bar
    automation can prompt for permission to control System Events.

  Raw activity stays on this Mac. AI features are optional and opt-in.

DONE

if confirm "Open Weekform now?"; then
  open "$DEST"
fi

info "Enjoy! Re-run this script anytime to rebuild the current checkout."
