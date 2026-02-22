#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

chmod +x "${ROOT_DIR}/scripts/publish-services.sh"
chmod +x "${ROOT_DIR}/scripts/publish-articles.sh"
chmod +x "${ROOT_DIR}/scripts/publish-blog-index.sh"
chmod +x "${ROOT_DIR}/scripts/build-content-graph.sh"

"${ROOT_DIR}/scripts/publish-services.sh"
"${ROOT_DIR}/scripts/publish-articles.sh"
"${ROOT_DIR}/scripts/publish-blog-index.sh"
"${ROOT_DIR}/scripts/build-content-graph.sh"

echo "Content pipeline completed."
