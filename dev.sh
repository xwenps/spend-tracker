#!/bin/sh
# dev-docker.sh — build, run, and clean up the app locally using .env for config
# Usage: ./dev-docker.sh

set -e

IMAGE_NAME="spend-tracker"

# ── Check .env exists ───────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "ERROR: .env file not found. Create one with:"
  echo ""
  echo "  CLIENT_ID=your-client-id.apps.googleusercontent.com"
  echo "  SHEET_ID=your-sheet-id"
  echo "  DOC_ID_CONFIG=your-config-doc-id"
  echo ""
  exit 1
fi

# ── Remove previous local image if it exists ────────────────────────────────
if docker image inspect "$IMAGE_NAME" > /dev/null 2>&1; then
  echo "Removing previous image: $IMAGE_NAME"
  docker rmi "$IMAGE_NAME"
fi

# ── Build fresh image ───────────────────────────────────────────────────────
echo "Building Docker image: $IMAGE_NAME"
docker build -f Dockerfile-dev -t "$IMAGE_NAME" .

# ── Prune dangling images left behind by the rebuild ────────────────────────
# (These are the untagged <none> layers that accumulate after each build)
echo "Pruning dangling images..."
docker image prune -f

# ── Run — container auto-removes itself on Ctrl+C ──────────────────────────
echo ""
echo "  App running at http://localhost:8080"
echo "  Press Ctrl+C to stop and remove the container"
echo ""
docker run --rm -p 8080:80 --env-file .env "$IMAGE_NAME"
