#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/content/.publish.env"
ARTICLES_DIR="${ROOT_DIR}/content/articles"
SERVICES_DIR="${ROOT_DIR}/content/services"
TEMPLATE_FILE="${ROOT_DIR}/content/templates/article-page.html"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi

: "${WP_BASE_URL:?Missing WP_BASE_URL in content/.publish.env}"
: "${WP_USERNAME:?Missing WP_USERNAME in content/.publish.env}"
: "${WP_APP_PASSWORD:?Missing WP_APP_PASSWORD in content/.publish.env}"

SERVICES_PARENT_SLUG="${SERVICES_PARENT_SLUG:-servizi-digital-agency}"
ARTICLE_BASE_PATH="${ARTICLE_BASE_PATH:-}"
DEFAULT_ARTICLE_STATUS="${DEFAULT_ARTICLE_STATUS:-draft}"
WP_POSTS_API="${WP_BASE_URL%/}/wp-json/wp/v2/posts"

if ! compgen -G "${ARTICLES_DIR}/*.md" >/dev/null; then
  echo "No article files found in ${ARTICLES_DIR}"
  exit 0
fi
if [[ ! -f "${TEMPLATE_FILE}" ]]; then
  echo "Missing template file: ${TEMPLATE_FILE}"
  exit 1
fi

get_meta() {
  local file="$1" key="$2"
  awk -v key="${key}" 'BEGIN{FS=": "} /^[[:space:]]*$/ {exit} $1==key {sub($1 FS, ""); print; exit}' "${file}"
}

get_body() {
  local file="$1"
  awk 'found{print} /^[[:space:]]*$/ {found=1}' "${file}"
}

escape_json_string() {
  local v="$1"
  v="${v//\\/\\\\}"; v="${v//\"/\\\"}"; v="${v//$'\n'/ }"; v="${v//$'\r'/ }"
  printf "%s" "${v}"
}

escape_js_string() {
  local v="$1"
  v="${v//\\/\\\\}"; v="${v//\'/\\\'}"
  printf "%s" "${v}"
}

csv_to_things_json() {
  local csv="$1" out="[" first=1 item
  arr=()
  IFS=',' read -r -a arr <<< "${csv:-}"
  for item in "${arr[@]-}"; do
    item="$(echo "${item}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -n "${item}" ]] || continue
    item="$(escape_json_string "${item}")"
    [[ ${first} -eq 1 ]] || out="${out},"
    out="${out}{\"@type\":\"Thing\",\"name\":\"${item}\"}"
    first=0
  done
  out="${out}]"
  printf "%s" "${out}"
}

get_post_id_by_slug() {
  local slug="$1" response
  response="$(curl -sS -u "${WP_USERNAME}:${WP_APP_PASSWORD}" "${WP_POSTS_API}?slug=${slug}&per_page=1&_fields=id,slug")"
  printf '%s' "${response}" | sed -n 's/.*"id":[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1
}

get_service_title_by_slug() {
  local slug="$1" f
  for f in "${SERVICES_DIR}"/*.md; do
    [[ -f "${f}" ]] || continue
    if [[ "$(get_meta "${f}" "slug")" == "${slug}" ]]; then
      get_meta "${f}" "title"; return 0
    fi
  done
  return 1
}

get_article_title_by_slug() {
  local slug="$1" f
  for f in "${ARTICLES_DIR}"/*.md; do
    [[ -f "${f}" ]] || continue
    if [[ "$(get_meta "${f}" "slug")" == "${slug}" ]]; then
      get_meta "${f}" "title"; return 0
    fi
  done
  return 1
}

render_related_services_section() {
  local csv="$1" html="" slug title
  arr=()
  IFS=',' read -r -a arr <<< "${csv:-}"
  for slug in "${arr[@]-}"; do
    slug="$(echo "${slug}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -n "${slug}" ]] || continue
    title="$(get_service_title_by_slug "${slug}" || true)"; [[ -n "${title}" ]] || title="${slug}"
    html="${html}<li><a href=\"/${SERVICES_PARENT_SLUG}/${slug}/\">${title}</a></li>"
  done
  if [[ -n "${html}" ]]; then
    printf '<section class="eda-related"><h2>Servizi correlati</h2><ul>%s</ul></section>' "${html}"
  fi
}

render_related_articles_section() {
  local csv="$1" html="" slug title url
  arr=()
  IFS=',' read -r -a arr <<< "${csv:-}"
  for slug in "${arr[@]-}"; do
    slug="$(echo "${slug}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -n "${slug}" ]] || continue
    title="$(get_article_title_by_slug "${slug}" || true)"; [[ -n "${title}" ]] || title="${slug}"
    if [[ -n "${ARTICLE_BASE_PATH}" ]]; then url="/${ARTICLE_BASE_PATH%/}/${slug}/"; else url="/${slug}/"; fi
    html="${html}<li><a href=\"${url}\">${title}</a></li>"
  done
  if [[ -n "${html}" ]]; then
    printf '<section class="eda-related"><h2>Articoli correlati</h2><ul>%s</ul></section>' "${html}"
  fi
}

upsert_post() {
  local slug="$1" title="$2" content="$3" excerpt="$4" status="$5" template="$6" post_id endpoint
  post_id="$(get_post_id_by_slug "${slug}")"
  endpoint="${WP_POSTS_API}"
  [[ -n "${post_id}" ]] && endpoint="${WP_POSTS_API}/${post_id}"

  local curl_args=(
    --data-urlencode "slug=${slug}"
    --data-urlencode "title=${title}"
    --data-urlencode "content=${content}"
    --data-urlencode "excerpt=${excerpt}"
    --data-urlencode "status=${status}"
  )
  [[ -n "${template}" ]] && curl_args+=(--data-urlencode "template=${template}")

  curl -sS -u "${WP_USERNAME}:${WP_APP_PASSWORD}" -X POST "${endpoint}" "${curl_args[@]}" >/dev/null
  if [[ -n "${post_id}" ]]; then
    echo "Updated article: ${slug} (id=${post_id})"
  else
    post_id="$(get_post_id_by_slug "${slug}")"
    echo "Created article: ${slug} (id=${post_id})"
  fi
}

update_rankmath_meta() {
  local post_id="$1" seo_title="$2" seo_description="$3" focus_keyword="$4" canonical_url="$5"
  local seo_title_e seo_desc_e focus_e canonical_e payload
  seo_title_e="$(escape_json_string "${seo_title}")"
  seo_desc_e="$(escape_json_string "${seo_description}")"
  focus_e="$(escape_json_string "${focus_keyword}")"
  canonical_e="$(escape_json_string "${canonical_url}")"
  payload="{\"meta\":{\"rank_math_title\":\"${seo_title_e}\",\"rank_math_description\":\"${seo_desc_e}\",\"rank_math_focus_keyword\":\"${focus_e}\""
  [[ -n "${canonical_url}" ]] && payload="${payload},\"rank_math_canonical_url\":\"${canonical_e}\""
  payload="${payload}}}"
  curl -sS -u "${WP_USERNAME}:${WP_APP_PASSWORD}" -X POST -H "Content-Type: application/json" \
    -d "${payload}" "${WP_POSTS_API}/${post_id}" >/dev/null
}

for file in "${ARTICLES_DIR}"/*.md; do
  slug="$(get_meta "${file}" "slug")"
  title="$(get_meta "${file}" "title")"
  excerpt="$(get_meta "${file}" "excerpt")"
  status="$(get_meta "${file}" "status")"
  article_class="$(get_meta "${file}" "article_class")"
  seo_title="$(get_meta "${file}" "seo_title")"
  seo_description="$(get_meta "${file}" "seo_description")"
  focus_keyword="$(get_meta "${file}" "focus_keyword")"
  canonical_url="$(get_meta "${file}" "canonical_url")"
  ai_entities="$(get_meta "${file}" "ai_entities")"
  ai_prompt="$(get_meta "${file}" "ai_prompt")"
  related_service_slugs="$(get_meta "${file}" "related_service_slugs")"
  related_article_slugs="$(get_meta "${file}" "related_article_slugs")"
  inline_links_html="$(get_meta "${file}" "inline_links_html")"
  body="$(get_body "${file}")"

  [[ -n "${slug}" && -n "${title}" ]] || { echo "Skipping ${file}: missing slug or title"; continue; }
  [[ -n "${status}" ]] || status="${DEFAULT_ARTICLE_STATUS}"
  [[ -n "${article_class}" ]] || article_class="eda-articolo-standard"
  [[ -n "${excerpt}" ]] || excerpt="${title}"
  [[ -n "${seo_title}" ]] || seo_title="${title}"
  [[ -n "${seo_description}" ]] || seo_description="${excerpt}"
  [[ -n "${focus_keyword}" ]] || focus_keyword="${title}"
  [[ -n "${ai_prompt}" ]] || ai_prompt="Riassumi in italiano l'articolo ${title} e spiega quando e utile."
  [[ -n "${ai_entities}" ]] || ai_entities="${title}, Easy Digital Agency, Roma"

  if [[ -n "${ARTICLE_BASE_PATH}" ]]; then article_url="${WP_BASE_URL%/}/${ARTICLE_BASE_PATH%/}/${slug}/"; else article_url="${WP_BASE_URL%/}/${slug}/"; fi
  ai_prompt_escaped="$(escape_js_string "${ai_prompt}")"
  seo_title_escaped="$(escape_json_string "${seo_title}")"
  seo_desc_escaped="$(escape_json_string "${seo_description}")"
  site_base_escaped="$(escape_json_string "${WP_BASE_URL%/}")"
  article_url_escaped="$(escape_json_string "${article_url}")"
  ai_entities_json="$(csv_to_things_json "${ai_entities}")"
  related_services_section="$(render_related_services_section "${related_service_slugs}")"
  related_articles_section="$(render_related_articles_section "${related_article_slugs}")"
  inline_links_section=""
  [[ -n "${inline_links_html}" ]] && inline_links_section="<section class=\"eda-related\"><h2>Link utili</h2>${inline_links_html}</section>"

  content="$(cat "${TEMPLATE_FILE}")"
  content="${content//__ARTICLE_CLASS__/${article_class}}"
  content="${content//__ARTICLE_TITLE__/${title}}"
  content="${content//__ARTICLE_EXCERPT__/${excerpt}}"
  content="${content//__ARTICLE_BODY__/${body}}"
  content="${content//__INLINE_LINKS_SECTION__/${inline_links_section}}"
  content="${content//__RELATED_SERVICES_SECTION__/${related_services_section}}"
  content="${content//__RELATED_ARTICLES_SECTION__/${related_articles_section}}"
  content="${content//__AI_PROMPT__/${ai_prompt_escaped}}"
  content="${content//__SEO_TITLE__/${seo_title_escaped}}"
  content="${content//__SEO_DESCRIPTION__/${seo_desc_escaped}}"
  content="${content//__SITE_BASE_URL__/${site_base_escaped}}"
  content="${content//__ARTICLE_URL__/${article_url_escaped}}"
  content="${content//__AI_ENTITIES_JSON__/${ai_entities_json}}"

  upsert_post "${slug}" "${title}" "${content}" "${excerpt}" "${status}" ""
  post_id="$(get_post_id_by_slug "${slug}")"
  [[ -n "${post_id}" ]] && update_rankmath_meta "${post_id}" "${seo_title}" "${seo_description}" "${focus_keyword}" "${canonical_url}"
done

echo "Done."
