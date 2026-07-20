#!/usr/bin/env bash

# Return success only for the unidentified ad-hoc signature shape emitted by
# local Tauri builds. A Developer ID, team-owned, or unknown signature must
# fail closed instead of being overwritten by the source installer.
is_repairable_local_signature() {
  local details="$1"

  printf '%s\n' "$details" | grep -Fxq 'Signature=adhoc' \
    && printf '%s\n' "$details" | grep -Fxq 'TeamIdentifier=not set' \
    && ! printf '%s\n' "$details" | grep -Eq '^Authority='
}
