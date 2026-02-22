#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/content/.publish.env"
SERVICES_DIR="${ROOT_DIR}/content/services"
ARTICLES_DIR="${ROOT_DIR}/content/articles"
OUT_DIR="${ROOT_DIR}/content/seo"
OUT_FILE="${OUT_DIR}/content-graph.json"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi

SERVICES_PARENT_SLUG="${SERVICES_PARENT_SLUG:-servizi-digital-agency}"
ARTICLE_BASE_PATH="${ARTICLE_BASE_PATH:-}"
WP_BASE_URL="${WP_BASE_URL:-https://example.com}"

mkdir -p "${OUT_DIR}"

escape_json() {
  local v="$1"
  v="${v//\\/\\\\}"; v="${v//\"/\\\"}"; v="${v//$'\n'/ }"; v="${v//$'\r'/ }"
  printf "%s" "${v}"
}

get_meta() {
  local file="$1" key="$2"
  awk -v key="${key}" 'BEGIN{FS=": "} /^[[:space:]]*$/ {exit} $1==key {sub($1 FS, ""); print; exit}' "${file}"
}

node_line() {
  local type="$1" slug="$2" title="$3" url="$4" file="$5" status="$6" focus="$7" related_services="$8" related_articles="$9"
  printf '{"type":"%s","slug":"%s","title":"%s","url":"%s","file":"%s","status":"%s","focus_keyword":"%s","related_service_slugs":"%s","related_article_slugs":"%s"}\n' \
    "$(escape_json "${type}")" "$(escape_json "${slug}")" "$(escape_json "${title}")" "$(escape_json "${url}")" \
    "$(escape_json "${file}")" "$(escape_json "${status}")" "$(escape_json "${focus}")" \
    "$(escape_json "${related_services}")" "$(escape_json "${related_articles}")"
}

tmp_nodes="$(mktemp)"
tmp_edges="$(mktemp)"
trap 'rm -f "${tmp_nodes}" "${tmp_edges}"' EXIT

for f in "${SERVICES_DIR}"/*.md; do
  [[ -f "${f}" ]] || continue
  slug="$(get_meta "${f}" "slug")"; title="$(get_meta "${f}" "title")"
  [[ -n "${slug}" && -n "${title}" ]] || continue
  status="$(get_meta "${f}" "status")"; focus="$(get_meta "${f}" "focus_keyword")"
  r_services="$(get_meta "${f}" "related_service_slugs")"; r_articles="$(get_meta "${f}" "related_article_slugs")"
  url="${WP_BASE_URL%/}/${SERVICES_PARENT_SLUG}/${slug}/"
  node_line "service" "${slug}" "${title}" "${url}" "${f#${ROOT_DIR}/}" "${status}" "${focus}" "${r_services}" "${r_articles}" >> "${tmp_nodes}"

  rsarr=()
  IFS=',' read -r -a rsarr <<< "${r_services:-}"
  for t in "${rsarr[@]-}"; do
    t="$(echo "${t}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"; [[ -n "${t}" ]] || continue
    printf '{"from":"%s","to":"%s","type":"related_service"}\n' "$(escape_json "${slug}")" "$(escape_json "${t}")" >> "${tmp_edges}"
  done
  raarr=()
  IFS=',' read -r -a raarr <<< "${r_articles:-}"
  for t in "${raarr[@]-}"; do
    t="$(echo "${t}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"; [[ -n "${t}" ]] || continue
    printf '{"from":"%s","to":"%s","type":"related_article"}\n' "$(escape_json "${slug}")" "$(escape_json "${t}")" >> "${tmp_edges}"
  done
done

for f in "${ARTICLES_DIR}"/*.md; do
  [[ -f "${f}" ]] || continue
  slug="$(get_meta "${f}" "slug")"; title="$(get_meta "${f}" "title")"
  [[ -n "${slug}" && -n "${title}" ]] || continue
  status="$(get_meta "${f}" "status")"; focus="$(get_meta "${f}" "focus_keyword")"
  r_services="$(get_meta "${f}" "related_service_slugs")"; r_articles="$(get_meta "${f}" "related_article_slugs")"
  if [[ -n "${ARTICLE_BASE_PATH}" ]]; then
    url="${WP_BASE_URL%/}/${ARTICLE_BASE_PATH%/}/${slug}/"
  else
    url="${WP_BASE_URL%/}/${slug}/"
  fi
  node_line "article" "${slug}" "${title}" "${url}" "${f#${ROOT_DIR}/}" "${status}" "${focus}" "${r_services}" "${r_articles}" >> "${tmp_nodes}"

  rsarr=()
  IFS=',' read -r -a rsarr <<< "${r_services:-}"
  for t in "${rsarr[@]-}"; do
    t="$(echo "${t}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"; [[ -n "${t}" ]] || continue
    printf '{"from":"%s","to":"%s","type":"related_service"}\n' "$(escape_json "${slug}")" "$(escape_json "${t}")" >> "${tmp_edges}"
  done
  raarr=()
  IFS=',' read -r -a raarr <<< "${r_articles:-}"
  for t in "${raarr[@]-}"; do
    t="$(echo "${t}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"; [[ -n "${t}" ]] || continue
    printf '{"from":"%s","to":"%s","type":"related_article"}\n' "$(escape_json "${slug}")" "$(escape_json "${t}")" >> "${tmp_edges}"
  done
done

{
  echo "{"
  echo "  \"generated_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"services_parent_slug\": \"$(escape_json "${SERVICES_PARENT_SLUG}")\","
  echo "  \"article_base_path\": \"$(escape_json "${ARTICLE_BASE_PATH}")\","
  echo "  \"nodes\": ["
  awk 'NR>1{printf(",\n")} {printf("    %s",$0)} END{printf("\n")}' "${tmp_nodes}"
  echo "  ],"
  echo "  \"edges\": ["
  awk 'NR>1{printf(",\n")} {printf("    %s",$0)} END{printf("\n")}' "${tmp_edges}"
  echo "  ]"
  echo "}"
} > "${OUT_FILE}"

echo "Generated ${OUT_FILE}"
