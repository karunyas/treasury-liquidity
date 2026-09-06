#!/usr/bin/env bash
# One-line setup: ./setup.sh
#
# Installs dependencies for both npm workspaces (server + web). There is
# nothing else to configure — no .env, no database server, no API key.
set -euo pipefail

REQUIRED_MAJOR=20

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js ${REQUIRED_MAJOR}+ is required but wasn't found." >&2
  echo "Install it from https://nodejs.org and re-run this script." >&2
  exit 1
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt "$REQUIRED_MAJOR" ]; then
  echo "Node.js ${REQUIRED_MAJOR}+ is required (found $(node -v))." >&2
  echo "Install a newer version from https://nodejs.org and re-run this script." >&2
  exit 1
fi

echo "==> Installing dependencies (server + web workspaces)…"
npm install

echo "==> Seeding a year of demo orders…"
npm run seed

cat <<'EOF'

Setup complete.

Start the app:
  npm run dev
Then open http://localhost:5173
EOF
