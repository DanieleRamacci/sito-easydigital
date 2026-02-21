#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/content/.publish.env"
SERVICES_DIR="${ROOT_DIR}/content/services"
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
WP_API_BASE="${WP_BASE_URL%/}/wp-json/wp/v2/pages"

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
  printf "%s" "${value}"
}

get_page_id_by_slug() {
  local slug="$1"
  local response
  response="$(curl -sS -u "${WP_USERNAME}:${WP_APP_PASSWORD}" "${WP_API_BASE}?slug=${slug}&per_page=1&_fields=id,slug")"
  printf '%s' "${response}" | sed -n 's/.*"id":[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1
}

upsert_page() {
  local slug="$1"
  local title="$2"
  local content="$3"
  local excerpt="$4"
  local status="$5"
  local parent_id="$6"
  local page_id
  page_id="$(get_page_id_by_slug "${slug}")"

  local endpoint="${WP_API_BASE}"
  if [[ -n "${page_id}" ]]; then
    endpoint="${WP_API_BASE}/${page_id}"
  fi

  curl -sS -u "${WP_USERNAME}:${WP_APP_PASSWORD}" -X POST "${endpoint}" \
    --data-urlencode "slug=${slug}" \
    --data-urlencode "title=${title}" \
    --data-urlencode "content=${content}" \
    --data-urlencode "excerpt=${excerpt}" \
    --data-urlencode "status=${status}" \
    --data-urlencode "parent=${parent_id}" \
    >/dev/null

  if [[ -n "${page_id}" ]]; then
    echo "Updated: ${slug} (id=${page_id})"
  else
    page_id="$(get_page_id_by_slug "${slug}")"
    echo "Created: ${slug} (id=${page_id})"
  fi
}

echo "Resolving parent services page..."
PARENT_ID="$(get_page_id_by_slug "${SERVICES_PARENT_SLUG}")"
if [[ -z "${PARENT_ID}" ]]; then
  upsert_page "${SERVICES_PARENT_SLUG}" "${SERVICES_PARENT_TITLE}" "<h1>${SERVICES_PARENT_TITLE}</h1>" "" "${PARENT_PAGE_STATUS}" "0"
  PARENT_ID="$(get_page_id_by_slug "${SERVICES_PARENT_SLUG}")"
fi

cards_html="<section class=\"eda-cards-grid\">"

for file in "${SERVICES_DIR}"/*.md; do
  if [[ "$(basename "${file}")" == "_generated-cards.html" ]]; then
    continue
  fi

  slug="$(get_meta "${file}" "slug")"
  title="$(get_meta "${file}" "title")"
  card_title="$(get_meta "${file}" "card_title")"
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
  ai_prompt="$(get_meta "${file}" "ai_prompt")"
  body="$(get_body "${file}")"

  if [[ -z "${slug}" || -z "${title}" ]]; then
    echo "Skipping ${file}: missing slug or title"
    continue
  fi

  if [[ -z "${card_title}" ]]; then
    card_title="${title}"
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
  if [[ -z "${ai_prompt}" ]]; then
    ai_prompt="Spiegami in italiano in modo semplice il servizio ${title} della web agency Easy Digital Agency."
  fi

  ai_prompt_escaped="$(escape_js_string "${ai_prompt}")"
  seo_title_escaped="$(escape_json_string "${seo_title}")"
  seo_description_escaped="$(escape_json_string "${seo_description}")"
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
  page_content="${page_content//__SERVICES_PARENT_SLUG__/${SERVICES_PARENT_SLUG}}"
  page_content="${page_content//__SERVICE_BODY__/${body}}"
  page_content="${page_content//__AI_PROMPT__/${ai_prompt_escaped}}"

  upsert_page "${slug}" "${title}" "${page_content}" "${excerpt}" "${status}" "${PARENT_ID}"

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
done

cards_html="${cards_html}
</section>"

index_content="$(cat "${INDEX_TEMPLATE_FILE}")"
index_content="${index_content//__SERVICES_PARENT_TITLE__/${SERVICES_PARENT_TITLE}}"
index_content="${index_content//__SERVICES_PARENT_INTRO__/${SERVICES_PARENT_INTRO}}"
index_content="${index_content//__CARDS__/${cards_html}}"

upsert_page "${SERVICES_PARENT_SLUG}" "${SERVICES_PARENT_TITLE}" "${index_content}" "${SERVICES_PARENT_INTRO}" "${PARENT_PAGE_STATUS}" "0"

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
