#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/content/.publish.env"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi

: "${WP_BASE_URL:?Missing WP_BASE_URL in content/.publish.env}"
: "${WP_USERNAME:?Missing WP_USERNAME in content/.publish.env}"
: "${WP_APP_PASSWORD:?Missing WP_APP_PASSWORD in content/.publish.env}"

TARGET_STATUS="${TARGET_STATUS:-draft}" # draft | trash
WP_PAGES_API="${WP_BASE_URL%/}/wp-json/wp/v2/pages"

if [[ $# -gt 0 ]]; then
  SLUGS=("$@")
else
  SLUGS=(
    "area-cliente-demo"
    "tabella-prezzi-servizi-demo"
    "negozio"
    "prenotazione-ricevuta"
  )
fi

get_page_ids_by_slug() {
  local slug="$1"
  curl -sS -u "${WP_USERNAME}:${WP_APP_PASSWORD}" \
    "${WP_PAGES_API}?slug=${slug}&per_page=100&_fields=id,slug,status" |
    sed -n 's/.*"id":[[:space:]]*\([0-9][0-9]*\).*/\1/p'
}

update_page_status() {
  local page_id="$1"
  curl -sS -u "${WP_USERNAME}:${WP_APP_PASSWORD}" -X POST \
    --data-urlencode "status=${TARGET_STATUS}" \
    "${WP_PAGES_API}/${page_id}" >/dev/null
}

echo "Target status: ${TARGET_STATUS}"
for slug in "${SLUGS[@]}"; do
  ids="$(get_page_ids_by_slug "${slug}" || true)"
  if [[ -z "${ids}" ]]; then
    echo "Not found: ${slug}"
    continue
  fi
  while IFS= read -r page_id; do
    [[ -n "${page_id}" ]] || continue
    update_page_status "${page_id}"
    echo "Updated page id=${page_id} slug=${slug} -> ${TARGET_STATUS}"
  done <<< "${ids}"
done

echo "Legacy page cleanup completed."
