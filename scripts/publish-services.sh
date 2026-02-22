#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/content/.publish.env"
SERVICES_DIR="${ROOT_DIR}/content/services"
ARTICLES_DIR="${ROOT_DIR}/content/articles"
TEMPLATE_FILE="${ROOT_DIR}/content/templates/service-page.html"
INDEX_TEMPLATE_FILE="${ROOT_DIR}/content/templates/services-index.html"
CARDS_OUT_FILE="${ROOT_DIR}/content/services/_generated-cards.html"
INDEX_OUT_FILE="${ROOT_DIR}/content/services/_generated-services-index.html"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi

: "${WP_BASE_URL:?Missing WP_BASE_URL in content/.publish.env}"
: "${WP_USERNAME:?Missing WP_USERNAME in content/.publish.env}"
: "${WP_APP_PASSWORD:?Missing WP_APP_PASSWORD in content/.publish.env}"

SERVICES_PARENT_SLUG="${SERVICES_PARENT_SLUG:-servizi-digital-agency}"
SERVICES_PARENT_TITLE="${SERVICES_PARENT_TITLE:-I Servizi Web Agency Digital a Roma}"
SERVICES_PARENT_INTRO="${SERVICES_PARENT_INTRO:-Scopri i servizi digitali pensati per far crescere il tuo business online.}"
DEFAULT_PAGE_STATUS="${DEFAULT_PAGE_STATUS:-draft}"
PARENT_PAGE_STATUS="${PARENT_PAGE_STATUS:-publish}"
SERVICE_PAGE_TEMPLATE="${SERVICE_PAGE_TEMPLATE:-elementor_header_footer}"
PARENT_PAGE_TEMPLATE="${PARENT_PAGE_TEMPLATE:-elementor_header_footer}"
WP_API_BASE="${WP_BASE_URL%/}/wp-json/wp/v2/pages"
ARTICLE_BASE_PATH="${ARTICLE_BASE_PATH:-}"

if ! compgen -G "${SERVICES_DIR}/*.md" >/dev/null; then
  echo "No service files found in ${SERVICES_DIR}"
  exit 1
fi

if [[ ! -f "${TEMPLATE_FILE}" ]]; then
  echo "Missing template file: ${TEMPLATE_FILE}"
  exit 1
fi

if [[ ! -f "${INDEX_TEMPLATE_FILE}" ]]; then
  echo "Missing template file: ${INDEX_TEMPLATE_FILE}"
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

escape_js_string() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\'/\\\'}"
  printf "%s" "${value}"
}

escape_json_string() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/ }"
  value="${value//$'\r'/ }"
  printf "%s" "${value}"
}

csv_to_things_json() {
  local csv="$1"
  local out="["
  local first=1
  local item
  arr=()
  IFS=',' read -r -a arr <<< "${csv:-}"
  for item in "${arr[@]-}"; do
    item="$(echo "${item}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    if [[ -z "${item}" ]]; then
      continue
    fi
    item="$(escape_json_string "${item}")"
    if [[ ${first} -eq 0 ]]; then
      out="${out},"
    fi
    out="${out}{\"@type\":\"Thing\",\"name\":\"${item}\"}"
    first=0
  done
  out="${out}]"
  printf "%s" "${out}"
}

get_page_id_by_slug() {
  local slug="$1"
  local response
  response="$(curl -sS -u "${WP_USERNAME}:${WP_APP_PASSWORD}" "${WP_API_BASE}?slug=${slug}&per_page=1&_fields=id,slug")"
  printf '%s' "${response}" | sed -n 's/.*"id":[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1
}

get_service_title_by_slug() {
  local slug="$1"
  local f
  for f in "${SERVICES_DIR}"/*.md; do
    [[ -f "${f}" ]] || continue
    if [[ "$(get_meta "${f}" "slug")" == "${slug}" ]]; then
      get_meta "${f}" "title"
      return 0
    fi
  done
  return 1
}

get_article_title_by_slug() {
  local slug="$1"
  local f
  for f in "${ARTICLES_DIR}"/*.md; do
    [[ -f "${f}" ]] || continue
    if [[ "$(get_meta "${f}" "slug")" == "${slug}" ]]; then
      get_meta "${f}" "title"
      return 0
    fi
  done
  return 1
}

render_related_services_section() {
  local csv="$1"
  local html=""
  local slug title
  arr=()
  IFS=',' read -r -a arr <<< "${csv:-}"
  for slug in "${arr[@]-}"; do
    slug="$(echo "${slug}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -n "${slug}" ]] || continue
    title="$(get_service_title_by_slug "${slug}" || true)"
    [[ -n "${title}" ]] || title="${slug}"
    html="${html}<li><a href=\"/${SERVICES_PARENT_SLUG}/${slug}/\">${title}</a></li>"
  done
  if [[ -n "${html}" ]]; then
    printf '<section class="eda-section"><h2>Servizi correlati</h2><ul>%s</ul></section>' "${html}"
  fi
}

render_related_articles_section() {
  local csv="$1"
  local html="" slug title article_url
  arr=()
  IFS=',' read -r -a arr <<< "${csv:-}"
  for slug in "${arr[@]-}"; do
    slug="$(echo "${slug}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -n "${slug}" ]] || continue
    title="$(get_article_title_by_slug "${slug}" || true)"
    [[ -n "${title}" ]] || title="${slug}"
    if [[ -n "${ARTICLE_BASE_PATH}" ]]; then
      article_url="/${ARTICLE_BASE_PATH%/}/${slug}/"
    else
      article_url="/${slug}/"
    fi
    html="${html}<li><a href=\"${article_url}\">${title}</a></li>"
  done
  if [[ -n "${html}" ]]; then
    printf '<section class="eda-section"><h2>Articoli correlati</h2><ul>%s</ul></section>' "${html}"
  fi
}

upsert_page() {
  local slug="$1"
  local title="$2"
  local content="$3"
  local excerpt="$4"
  local status="$5"
  local parent_id="$6"
  local template="$7"
  local page_id
  page_id="$(get_page_id_by_slug "${slug}")"

  local endpoint="${WP_API_BASE}"
  if [[ -n "${page_id}" ]]; then
    endpoint="${WP_API_BASE}/${page_id}"
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

  curl -sS -u "${WP_USERNAME}:${WP_APP_PASSWORD}" -X POST "${endpoint}" \
    "${curl_args[@]}" >/dev/null

  if [[ -n "${page_id}" ]]; then
    echo "Updated: ${slug} (id=${page_id})"
  else
    page_id="$(get_page_id_by_slug "${slug}")"
    echo "Created: ${slug} (id=${page_id})"
  fi
}

update_rankmath_meta() {
  local page_id="$1"
  local seo_title="$2"
  local seo_description="$3"
  local focus_keyword="$4"
  local canonical_url="$5"

  local seo_title_e seo_desc_e focus_e canonical_e payload response
  seo_title_e="$(escape_json_string "${seo_title}")"
  seo_desc_e="$(escape_json_string "${seo_description}")"
  focus_e="$(escape_json_string "${focus_keyword}")"
  canonical_e="$(escape_json_string "${canonical_url}")"

  payload="{\"meta\":{\"rank_math_title\":\"${seo_title_e}\",\"rank_math_description\":\"${seo_desc_e}\",\"rank_math_focus_keyword\":\"${focus_e}\""
  if [[ -n "${canonical_url}" ]]; then
    payload="${payload},\"rank_math_canonical_url\":\"${canonical_e}\""
  fi
  payload="${payload}}}"

  response="$(curl -sS -u "${WP_USERNAME}:${WP_APP_PASSWORD}" -X POST \
    -H "Content-Type: application/json" \
    -d "${payload}" \
    "${WP_API_BASE}/${page_id}")"

  if echo "${response}" | grep -q '"code":"rest_invalid_param"'; then
    echo "Warning: Rank Math meta not accepted for page id=${page_id}. Check Rank Math REST/meta settings."
  fi
}

echo "Resolving parent services page..."
PARENT_ID="$(get_page_id_by_slug "${SERVICES_PARENT_SLUG}")"
if [[ -z "${PARENT_ID}" ]]; then
  upsert_page "${SERVICES_PARENT_SLUG}" "${SERVICES_PARENT_TITLE}" "<h1>${SERVICES_PARENT_TITLE}</h1>" "" "${PARENT_PAGE_STATUS}" "0" "${PARENT_PAGE_TEMPLATE}"
  PARENT_ID="$(get_page_id_by_slug "${SERVICES_PARENT_SLUG}")"
fi

cards_html=""
current_category=""

TMP_SERVICE_INDEX="$(mktemp)"
for file in "${SERVICES_DIR}"/*.md; do
  [[ -f "${file}" ]] || continue
  if [[ "$(basename "${file}")" == "_generated-cards.html" || "$(basename "${file}")" == "_generated-services-index.html" ]]; then
    continue
  fi
  category_idx="$(get_meta "${file}" "category")"
  if [[ -z "${category_idx}" ]]; then
    category_idx="Servizi web agency : Design & Development"
  fi
  sort_order_idx="$(get_meta "${file}" "sort_order")"
  if [[ -z "${sort_order_idx}" || ! "${sort_order_idx}" =~ ^[0-9]+$ ]]; then
    sort_order_idx="999"
  fi
  printf "%s\t%06d\t%s\n" "${category_idx}" "${sort_order_idx}" "${file}" >> "${TMP_SERVICE_INDEX}"
done

while IFS=$'\t' read -r _cat _ord file; do
  [[ -f "${file}" ]] || continue

  slug="$(get_meta "${file}" "slug")"
  title="$(get_meta "${file}" "title")"
  card_title="$(get_meta "${file}" "card_title")"
  category="$(get_meta "${file}" "category")"
  sort_order_raw="$(get_meta "${file}" "sort_order")"
  excerpt="$(get_meta "${file}" "excerpt")"
  status="$(get_meta "${file}" "status")"
  service_class="$(get_meta "${file}" "service_class")"
  badge_label="$(get_meta "${file}" "badge_label")"
  cta_primary_text="$(get_meta "${file}" "cta_primary_text")"
  cta_primary_url="$(get_meta "${file}" "cta_primary_url")"
  hero_services_title="$(get_meta "${file}" "hero_services_title")"
  service_included_list="$(get_meta "${file}" "service_included_list")"
  context_title="$(get_meta "${file}" "context_title")"
  context_intro="$(get_meta "${file}" "context_intro")"
  seo_title="$(get_meta "${file}" "seo_title")"
  seo_description="$(get_meta "${file}" "seo_description")"
  focus_keyword="$(get_meta "${file}" "focus_keyword")"
  canonical_url="$(get_meta "${file}" "canonical_url")"
  ai_entities="$(get_meta "${file}" "ai_entities")"
  related_service_slugs="$(get_meta "${file}" "related_service_slugs")"
  related_article_slugs="$(get_meta "${file}" "related_article_slugs")"
  inline_links_html="$(get_meta "${file}" "inline_links_html")"
  ai_prompt="$(get_meta "${file}" "ai_prompt")"
  body="$(get_body "${file}")"

  if [[ -z "${slug}" || -z "${title}" ]]; then
    echo "Skipping ${file}: missing slug or title"
    continue
  fi
  if [[ "${slug}" == "${SERVICES_PARENT_SLUG}" ]]; then
    echo "Skipping ${file}: slug '${slug}' conflicts with parent page slug '${SERVICES_PARENT_SLUG}'"
    continue
  fi

  if [[ -z "${card_title}" ]]; then
    card_title="${title}"
  fi
  if [[ -z "${category}" ]]; then
    category="Servizi web agency : Design & Development"
  fi
  if [[ -z "${status}" ]]; then
    status="${DEFAULT_PAGE_STATUS}"
  fi
  if [[ -z "${service_class}" ]]; then
    service_class="eda-servizio-standard"
  fi
  if [[ -z "${badge_label}" ]]; then
    badge_label="Servizio professionale"
  fi
  if [[ -z "${cta_primary_text}" ]]; then
    cta_primary_text="Richiedi un preventivo"
  fi
  if [[ -z "${cta_primary_url}" ]]; then
    cta_primary_url="/contatti"
  fi
  if [[ -z "${hero_services_title}" ]]; then
    hero_services_title="Servizi inclusi"
  fi
  if [[ -z "${service_included_list}" ]]; then
    service_included_list="<div class=\"eda-service-item\"><div class=\"eda-service-item-left\"><span class=\"eda-service-bullet\"></span><span class=\"eda-service-label\">Analisi iniziale</span></div><span class=\"eda-service-tag\">Start</span></div><div class=\"eda-service-item\"><div class=\"eda-service-item-left\"><span class=\"eda-service-bullet\"></span><span class=\"eda-service-label\">Implementazione</span></div><span class=\"eda-service-tag\">Operativo</span></div><div class=\"eda-service-item\"><div class=\"eda-service-item-left\"><span class=\"eda-service-bullet\"></span><span class=\"eda-service-label\">Ottimizzazione continua</span></div><span class=\"eda-service-tag\">Growth</span></div>"
  fi
  if [[ -z "${context_title}" ]]; then
    context_title="Perche investire in questo servizio"
  fi
  if [[ -z "${context_intro}" ]]; then
    context_intro="Ogni progetto digitale ha bisogno di una base tecnica solida, contenuti chiari e obiettivi misurabili. Con questo servizio trasformiamo il sito in uno strumento di crescita, non in una semplice vetrina."
  fi
  if [[ -z "${seo_title}" ]]; then
    seo_title="${title}"
  fi
  if [[ -z "${seo_description}" ]]; then
    seo_description="${excerpt}"
  fi
  if [[ -z "${focus_keyword}" ]]; then
    focus_keyword="${title}"
  fi
  if [[ -z "${ai_prompt}" ]]; then
    ai_prompt="Spiegami in italiano in modo semplice il servizio ${title} della web agency Easy Digital Agency."
  fi
  if [[ -z "${ai_entities}" ]]; then
    ai_entities="${title}, Easy Digital Agency, Roma, Web Agency"
  fi

  ai_prompt_escaped="$(escape_js_string "${ai_prompt}")"
  seo_title_escaped="$(escape_json_string "${seo_title}")"
  seo_description_escaped="$(escape_json_string "${seo_description}")"
  service_url="${WP_BASE_URL%/}/${SERVICES_PARENT_SLUG}/${slug}/"
  service_url_escaped="$(escape_json_string "${service_url}")"
  site_base_escaped="$(escape_json_string "${WP_BASE_URL%/}")"
  ai_entities_json="$(csv_to_things_json "${ai_entities}")"
  related_services_section="$(render_related_services_section "${related_service_slugs}")"
  related_articles_section="$(render_related_articles_section "${related_article_slugs}")"
  inline_links_section=""
  if [[ -n "${inline_links_html}" ]]; then
    inline_links_section="<section class=\"eda-section\"><h2>Link utili</h2>${inline_links_html}</section>"
  fi
  page_content="$(cat "${TEMPLATE_FILE}")"
  page_content="${page_content//__SERVICE_CLASS__/${service_class}}"
  page_content="${page_content//__BADGE_LABEL__/${badge_label}}"
  page_content="${page_content//__SERVICE_TITLE__/${title}}"
  page_content="${page_content//__SERVICE_EXCERPT__/${excerpt}}"
  page_content="${page_content//__CTA_PRIMARY_TEXT__/${cta_primary_text}}"
  page_content="${page_content//__CTA_PRIMARY_URL__/${cta_primary_url}}"
  page_content="${page_content//__HERO_SERVICES_TITLE__/${hero_services_title}}"
  page_content="${page_content//__SERVICE_INCLUDED_LIST__/${service_included_list}}"
  page_content="${page_content//__CONTEXT_TITLE__/${context_title}}"
  page_content="${page_content//__CONTEXT_INTRO__/${context_intro}}"
  page_content="${page_content//__SEO_TITLE__/${seo_title_escaped}}"
  page_content="${page_content//__SEO_DESCRIPTION__/${seo_description_escaped}}"
  page_content="${page_content//__SITE_BASE_URL__/${site_base_escaped}}"
  page_content="${page_content//__SERVICE_URL__/${service_url_escaped}}"
  page_content="${page_content//__AI_ENTITIES_JSON__/${ai_entities_json}}"
  page_content="${page_content//__SERVICES_PARENT_SLUG__/${SERVICES_PARENT_SLUG}}"
  page_content="${page_content//__SERVICE_BODY__/${body}}"
  page_content="${page_content//__INLINE_LINKS_SECTION__/${inline_links_section}}"
  page_content="${page_content//__RELATED_SERVICES_SECTION__/${related_services_section}}"
  page_content="${page_content//__RELATED_ARTICLES_SECTION__/${related_articles_section}}"
  page_content="${page_content//__AI_PROMPT__/${ai_prompt_escaped}}"

  upsert_page "${slug}" "${title}" "${page_content}" "${excerpt}" "${status}" "${PARENT_ID}" "${SERVICE_PAGE_TEMPLATE}"
  page_id="$(get_page_id_by_slug "${slug}")"
  if [[ -n "${page_id}" ]]; then
    update_rankmath_meta "${page_id}" "${seo_title}" "${seo_description}" "${focus_keyword}" "${canonical_url}"
  fi

  if [[ "${category}" != "${current_category}" ]]; then
    if [[ -n "${current_category}" ]]; then
      cards_html="${cards_html}
</section>
</section>"
    fi
    current_category="${category}"
    cards_html="${cards_html}
<section class=\"eda-category\">
  <h2>${category}</h2>
  <section class=\"eda-cards-grid\">"
  fi

  cards_html="${cards_html}
<article class=\"eda-service-card\">
  <header class=\"eda-service-card-head\">
    <h3>${card_title}</h3>
    <span class=\"eda-service-card-divider\"></span>
  </header>
  <div class=\"eda-service-card-body\">
    <p>${excerpt}</p>
  </div>
  <footer class=\"eda-service-card-foot\">
    <a class=\"eda-service-btn\" href=\"/${SERVICES_PARENT_SLUG}/${slug}/\">Leggi tutto</a>
  </footer>
</article>"
done < <(sort -t $'\t' -k1,1 -k2,2n -k3,3 "${TMP_SERVICE_INDEX}")

rm -f "${TMP_SERVICE_INDEX}"

if [[ -n "${current_category}" ]]; then
  cards_html="${cards_html}
</section>
</section>"
fi

index_content="$(cat "${INDEX_TEMPLATE_FILE}")"
index_content="${index_content//__SERVICES_PARENT_TITLE__/${SERVICES_PARENT_TITLE}}"
index_content="${index_content//__SERVICES_PARENT_INTRO__/${SERVICES_PARENT_INTRO}}"
index_content="${index_content//__CARDS__/${cards_html}}"

upsert_page "${SERVICES_PARENT_SLUG}" "${SERVICES_PARENT_TITLE}" "${index_content}" "${SERVICES_PARENT_INTRO}" "${PARENT_PAGE_STATUS}" "0" "${PARENT_PAGE_TEMPLATE}"

cat > "${CARDS_OUT_FILE}" <<EOF
<!-- Incolla questo blocco nella pagina madre /${SERVICES_PARENT_SLUG}/ -->
${cards_html}
EOF

cat > "${INDEX_OUT_FILE}" <<EOF
${index_content}
EOF

echo "Cards snippet generated in: ${CARDS_OUT_FILE}"
echo "Index preview generated in: ${INDEX_OUT_FILE}"
echo "Done."
