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

WP_PAGES_API="${WP_BASE_URL%/}/wp-json/wp/v2/pages"
PAGE_TEMPLATE="${PAGE_TEMPLATE:-elementor_header_footer}"

get_page_id_by_slug() {
  local slug="$1" response
  response="$(curl -sS -u "${WP_USERNAME}:${WP_APP_PASSWORD}" "${WP_PAGES_API}?slug=${slug}&per_page=1&_fields=id,slug")"
  printf '%s' "${response}" | sed -n 's/.*"id":[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1
}

upsert_page() {
  local slug="$1" title="$2" content="$3" excerpt="$4" status="$5" template="$6"
  local page_id endpoint
  page_id="$(get_page_id_by_slug "${slug}")"
  endpoint="${WP_PAGES_API}"
  [[ -n "${page_id}" ]] && endpoint="${WP_PAGES_API}/${page_id}"

  local curl_args=(
    --data-urlencode "slug=${slug}"
    --data-urlencode "title=${title}"
    --data-urlencode "content=${content}"
    --data-urlencode "excerpt=${excerpt}"
    --data-urlencode "status=${status}"
  )
  [[ -n "${template}" ]] && curl_args+=(--data-urlencode "template=${template}")

  curl -sS -u "${WP_USERNAME}:${WP_APP_PASSWORD}" -X POST "${endpoint}" "${curl_args[@]}" >/dev/null

  if [[ -n "${page_id}" ]]; then
    echo "Updated page: ${slug} (id=${page_id})"
  else
    page_id="$(get_page_id_by_slug "${slug}")"
    echo "Created page: ${slug} (id=${page_id})"
  fi
}

CLIENT_SLUG="area-cliente-demo"
CLIENT_TITLE="Area Cliente Demo"
CLIENT_EXCERPT="Pagina demo area cliente con servizi attivi, storico e ticket."
CLIENT_CONTENT='[eda_client_portal]'

PRICING_SLUG="tabella-prezzi-servizi-demo"
PRICING_TITLE="Tabella Prezzi Servizi Demo"
PRICING_EXCERPT="Pagina demo tabella pacchetti e prezzi servizi."
PRICING_CONTENT='[eda_service_pricing]'

upsert_page "${CLIENT_SLUG}" "${CLIENT_TITLE}" "${CLIENT_CONTENT}" "${CLIENT_EXCERPT}" "publish" "${PAGE_TEMPLATE}"
upsert_page "${PRICING_SLUG}" "${PRICING_TITLE}" "${PRICING_CONTENT}" "${PRICING_EXCERPT}" "publish" "${PAGE_TEMPLATE}"

echo "Done."
echo "Area Cliente: ${WP_BASE_URL%/}/${CLIENT_SLUG}/"
echo "Prezzi Servizi: ${WP_BASE_URL%/}/${PRICING_SLUG}/"
