#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/content/.publish.env"
EN_DIR="${ROOT_DIR}/content/landing-pages/en"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi

: "${WP_BASE_URL:?Missing WP_BASE_URL in content/.publish.env}"
: "${WP_USERNAME:?Missing WP_USERNAME in content/.publish.env}"
: "${WP_APP_PASSWORD:?Missing WP_APP_PASSWORD in content/.publish.env}"

EN_PARENT_SLUG="${EN_PARENT_SLUG:-en}"
EN_PARENT_TITLE="${EN_PARENT_TITLE:-English}"
EN_PARENT_STATUS="${EN_PARENT_STATUS:-publish}"
EN_PARENT_TEMPLATE="${EN_PARENT_TEMPLATE:-elementor_header_footer}"
EN_DEFAULT_STATUS="${EN_DEFAULT_STATUS:-draft}"
EN_DEFAULT_TEMPLATE="${EN_DEFAULT_TEMPLATE:-elementor_header_footer}"

WP_PAGES_API="${WP_BASE_URL%/}/wp-json/wp/v2/pages"

if ! compgen -G "${EN_DIR}/*.md" >/dev/null; then
  echo "No English page files found in ${EN_DIR}"
  exit 1
fi

get_meta() {
  local file="$1"
  local key="$2"
  awk -v key="${key}" 'BEGIN{FS=": "} /^[[:space:]]*$/ {exit} $1==key {sub($1 FS, ""); print; exit}' "${file}"
}

get_body() {
  local file="$1"
  awk 'found{print} /^[[:space:]]*$/ {found=1}' "${file}"
}

to_gutenberg_html_block() {
  local raw="$1"
  if [[ "${raw}" == *"<!-- wp:html -->"* ]]; then
    printf "%s" "${raw}"
    return 0
  fi

  printf "<!-- wp:html -->\n%s\n<!-- /wp:html -->" "${raw}"
}

escape_json_string() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/ }"
  value="${value//$'\r'/ }"
  printf "%s" "${value}"
}

get_page_id_by_slug() {
  local slug="$1"
  local response
  response="$(curl -sS -u "${WP_USERNAME}:${WP_APP_PASSWORD}" "${WP_PAGES_API}?slug=${slug}&per_page=1&_fields=id,slug")"
  printf '%s' "${response}" | sed -n 's/.*"id":[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1
}

get_child_page_id_by_slug_parent() {
  local slug="$1"
  local parent_id="$2"
  local response
  response="$(curl -sS -u "${WP_USERNAME}:${WP_APP_PASSWORD}" "${WP_PAGES_API}?slug=${slug}&parent=${parent_id}&per_page=1&_fields=id,slug,parent")"
  printf '%s' "${response}" | sed -n 's/.*"id":[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1
}

upsert_page() {
  local slug="$1"
  local title="$2"
  local content="$3"
  local excerpt="$4"
  local status="$5"
  local parent_id="$6"
  local template="$7"
  local page_id="$8"

  local endpoint="${WP_PAGES_API}"
  if [[ -n "${page_id}" ]]; then
    endpoint="${WP_PAGES_API}/${page_id}"
  fi

  local curl_args=(
    --data-urlencode "slug=${slug}"
    --data-urlencode "title=${title}"
    --data-urlencode "content=${content}"
    --data-urlencode "excerpt=${excerpt}"
    --data-urlencode "status=${status}"
    --data-urlencode "parent=${parent_id}"
  )
  if [[ -n "${template}" ]]; then
    curl_args+=(--data-urlencode "template=${template}")
  fi

  curl -sS -u "${WP_USERNAME}:${WP_APP_PASSWORD}" -X POST "${endpoint}" "${curl_args[@]}" >/dev/null
}

update_rankmath_meta() {
  local page_id="$1"
  local seo_title="$2"
  local seo_description="$3"
  local focus_keyword="$4"
  local canonical_url="$5"

  local seo_title_e seo_desc_e focus_e canonical_e payload
  seo_title_e="$(escape_json_string "${seo_title}")"
  seo_desc_e="$(escape_json_string "${seo_description}")"
  focus_e="$(escape_json_string "${focus_keyword}")"
  canonical_e="$(escape_json_string "${canonical_url}")"

  payload="{\"meta\":{\"rank_math_title\":\"${seo_title_e}\",\"rank_math_description\":\"${seo_desc_e}\",\"rank_math_focus_keyword\":\"${focus_e}\""
  if [[ -n "${canonical_url}" ]]; then
    payload="${payload},\"rank_math_canonical_url\":\"${canonical_e}\""
  fi
  payload="${payload}}}"

  curl -sS -u "${WP_USERNAME}:${WP_APP_PASSWORD}" -X POST \
    -H "Content-Type: application/json" \
    -d "${payload}" \
    "${WP_PAGES_API}/${page_id}" >/dev/null
}

echo "Resolving /${EN_PARENT_SLUG}/ parent page..."
EN_PARENT_ID="$(get_page_id_by_slug "${EN_PARENT_SLUG}")"
if [[ -z "${EN_PARENT_ID}" ]]; then
  upsert_page "${EN_PARENT_SLUG}" "${EN_PARENT_TITLE}" "<h1>${EN_PARENT_TITLE}</h1>" "English pages index" "${EN_PARENT_STATUS}" "0" "${EN_PARENT_TEMPLATE}" ""
  EN_PARENT_ID="$(get_page_id_by_slug "${EN_PARENT_SLUG}")"
fi

for file in "${EN_DIR}"/*.md; do
  slug="$(get_meta "${file}" "slug")"
  title="$(get_meta "${file}" "title")"
  excerpt="$(get_meta "${file}" "excerpt")"
  status="$(get_meta "${file}" "status")"
  template="$(get_meta "${file}" "template")"
  seo_title="$(get_meta "${file}" "seo_title")"
  seo_description="$(get_meta "${file}" "seo_description")"
  focus_keyword="$(get_meta "${file}" "focus_keyword")"
  canonical_url="$(get_meta "${file}" "canonical_url")"
  body="$(get_body "${file}")"
  body="$(to_gutenberg_html_block "${body}")"

  if [[ -z "${slug}" || -z "${title}" ]]; then
    echo "Skipping ${file}: missing slug or title"
    continue
  fi

  [[ -n "${excerpt}" ]] || excerpt="${title}"
  [[ -n "${status}" ]] || status="${EN_DEFAULT_STATUS}"
  [[ -n "${template}" ]] || template="${EN_DEFAULT_TEMPLATE}"
  [[ -n "${seo_title}" ]] || seo_title="${title}"
  [[ -n "${seo_description}" ]] || seo_description="${excerpt}"
  [[ -n "${focus_keyword}" ]] || focus_keyword="${title}"
  [[ -n "${canonical_url}" ]] || canonical_url="${WP_BASE_URL%/}/${EN_PARENT_SLUG}/${slug}/"

  existing_child_id="$(get_child_page_id_by_slug_parent "${slug}" "${EN_PARENT_ID}")"
  upsert_page "${slug}" "${title}" "${body}" "${excerpt}" "${status}" "${EN_PARENT_ID}" "${template}" "${existing_child_id}"

  if [[ -n "${existing_child_id}" ]]; then
    child_id="${existing_child_id}"
  else
    child_id="$(get_child_page_id_by_slug_parent "${slug}" "${EN_PARENT_ID}")"
  fi

  if [[ -n "${child_id}" ]]; then
    update_rankmath_meta "${child_id}" "${seo_title}" "${seo_description}" "${focus_keyword}" "${canonical_url}"
    echo "Published EN page: /${EN_PARENT_SLUG}/${slug}/ (id=${child_id})"
  else
    echo "Warning: could not resolve page id for slug=${slug}"
  fi
done

echo "English pages publish completed."
