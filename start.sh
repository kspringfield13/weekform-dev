#!/usr/bin/env bash

# Stable entry point for the downloadable Weekform source package.
# The reviewed installer owns prerequisite checks, the native build, the
# Applications copy, rollback, cleanup, permission guidance, and launch.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/scripts/install.command"
