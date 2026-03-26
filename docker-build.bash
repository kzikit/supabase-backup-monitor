#!/usr/bin/env bash
set -euo pipefail

# Bouw en push de Docker image naar ghcr.io.
# Voor amd64 targets: gebruik GitHub Actions of buildx.

REGISTRY="ghcr.io"
OWNER=$(git remote get-url origin | sed -E 's#.*[:/]([^/]+)/.*#\1#' | tr '[:upper:]' '[:lower:]')
IMAGE_NAME="supabase-backup-monitor"
FULL_IMAGE="${REGISTRY}/${OWNER}/${IMAGE_NAME}"

GIT_HASH=$(git rev-parse --short HEAD)
TAG_HASH="${FULL_IMAGE}:${GIT_HASH}"
TAG_LATEST="${FULL_IMAGE}:latest"

echo "==> Image bouwen: ${TAG_HASH}"
docker build \
  -t "${TAG_HASH}" \
  -t "${TAG_LATEST}" \
  .

echo "==> Pushen naar ${REGISTRY}..."
docker push "${TAG_HASH}"
docker push "${TAG_LATEST}"

echo "==> Klaar: ${TAG_HASH} en ${TAG_LATEST} gepusht."
