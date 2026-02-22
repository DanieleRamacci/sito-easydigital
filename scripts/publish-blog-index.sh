#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/content/.publish.env"
TEMPLATE_FILE="${ROOT_DIR}/content/templates/blog-index.html"
OUT_FILE="${ROOT_DIR}/content/articles/_generated-blog-index.html"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi

: "${WP_BASE_URL:?Missing WP_BASE_URL in content/.publish.env}"
: "${WP_USERNAME:?Missing WP_USERNAME in content/.publish.env}"
: "${WP_APP_PASSWORD:?Missing WP_APP_PASSWORD in content/.publish.env}"

BLOG_INDEX_SLUG="${BLOG_INDEX_SLUG:-articoli-e-guide-digitali}"
BLOG_INDEX_TITLE="${BLOG_INDEX_TITLE:-Articoli e Guide Digitali}"
BLOG_INDEX_INTRO="${BLOG_INDEX_INTRO:-Approfondimenti pratici su SEO, WordPress, performance e crescita online.}"
BLOG_INDEX_STATUS="${BLOG_INDEX_STATUS:-publish}"
BLOG_INDEX_TEMPLATE="${BLOG_INDEX_TEMPLATE:-elementor_header_footer}"
WP_PAGES_API="${WP_BASE_URL%/}/wp-json/wp/v2/pages"

if [[ ! -f "${TEMPLATE_FILE}" ]]; then
  echo "Missing template file: ${TEMPLATE_FILE}"
  exit 1
fi

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
    echo "Updated blog hub: ${slug} (id=${page_id})"
  else
    page_id="$(get_page_id_by_slug "${slug}")"
    echo "Created blog hub: ${slug} (id=${page_id})"
  fi
}

tmp_render="$(mktemp)"
trap 'rm -f "${tmp_render}"' EXIT

WP_BASE_URL="${WP_BASE_URL}" \
WP_USERNAME="${WP_USERNAME}" \
WP_APP_PASSWORD="${WP_APP_PASSWORD}" \
TEMPLATE_FILE="${TEMPLATE_FILE}" \
BLOG_INDEX_TITLE="${BLOG_INDEX_TITLE}" \
BLOG_INDEX_INTRO="${BLOG_INDEX_INTRO}" \
python3 - <<'PY' > "${tmp_render}"
import os
import re
import json
import html
import base64
import urllib.request
import urllib.parse
from datetime import datetime

wp_base = os.environ["WP_BASE_URL"].rstrip("/")
wp_user = os.environ["WP_USERNAME"]
wp_pass = os.environ["WP_APP_PASSWORD"]
template_path = os.environ["TEMPLATE_FILE"]
title = os.environ["BLOG_INDEX_TITLE"]
intro = os.environ["BLOG_INDEX_INTRO"]

def fetch_json(url):
    token = base64.b64encode(f"{wp_user}:{wp_pass}".encode("utf-8")).decode("ascii")
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Basic {token}")
    with urllib.request.urlopen(req, timeout=25) as resp:
        body = resp.read().decode("utf-8")
        headers = dict(resp.headers.items())
    return json.loads(body), headers

def strip_html(s):
    if not s:
        return ""
    return re.sub(r"<[^>]+>", "", s).strip()

def date_it(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).strftime("%d/%m/%Y")
    except Exception:
        return ""

def card(post):
    cat = post.get("cat_name") or "Generale"
    title_txt = strip_html(post.get("title", {}).get("rendered", ""))
    excerpt_txt = strip_html(post.get("excerpt", {}).get("rendered", "")) or "Apri l'articolo per leggere l'approfondimento completo."
    link = post.get("link", "#")
    dt = date_it(post.get("date", ""))
    return (
        '<article class="eda-card">'
        f'<div class="eda-cat">{html.escape(cat)}</div>'
        f'<h3><a href="{html.escape(link)}">{html.escape(title_txt)}</a></h3>'
        f'<p>{html.escape(excerpt_txt)}</p>'
        '<div class="eda-foot">'
        f'<span>{html.escape(dt)}</span>'
        f'<a class="eda-link" href="{html.escape(link)}">Leggi articolo →</a>'
        '</div>'
        '</article>'
    )

q = urllib.parse.urlencode({
    "per_page": 100,
    "page": 1,
    "_embed": 1,
    "status": "publish",
})
first_url = f"{wp_base}/wp-json/wp/v2/posts?{q}"
first, headers = fetch_json(first_url)
total_pages = int(headers.get("X-WP-TotalPages", "1") or "1")
posts = list(first)
for page in range(2, total_pages + 1):
    q2 = urllib.parse.urlencode({
        "per_page": 100,
        "page": page,
        "_embed": 1,
        "status": "publish",
    })
    arr, _ = fetch_json(f"{wp_base}/wp-json/wp/v2/posts?{q2}")
    posts.extend(arr)

def enrich(post):
    terms = []
    embedded = post.get("_embedded", {})
    if isinstance(embedded, dict):
        terms = embedded.get("wp:term", [])
    cat = None
    if terms and isinstance(terms, list):
        for grp in terms:
            if isinstance(grp, list):
                for t in grp:
                    if isinstance(t, dict) and t.get("taxonomy") == "category":
                        cat = t
                        break
            if cat:
                break
    post["cat_name"] = (cat or {}).get("name", "Generale")
    post["cat_slug"] = (cat or {}).get("slug", "generale")
    return post

posts = [enrich(p) for p in posts]
posts.sort(key=lambda p: p.get("date", ""), reverse=True)

featured = [p for p in posts if p.get("sticky")]
if not featured:
    featured = posts[:3]
latest = posts[:6]

cats = {}
for p in posts:
    k = p.get("cat_slug", "generale")
    if k not in cats:
        cats[k] = {"name": p.get("cat_name", "Generale"), "slug": k}

cats_sorted = sorted(cats.values(), key=lambda x: x["name"].lower())

categories_list = "".join(
    f'<li><a href="#cat-{html.escape(c["slug"])}">{html.escape(c["name"])}</a></li>'
    for c in cats_sorted
)
if not categories_list:
    categories_list = "<li><a href=\"#\">Nessuna categoria</a></li>"

archive_sections = []
for c in cats_sorted:
    group = [p for p in posts if p.get("cat_slug") == c["slug"]]
    cards = "".join(card(p) for p in group)
    if not cards:
        cards = '<div class="eda-empty">Nessun articolo in questa categoria.</div>'
    archive_sections.append(
        f'<section id="cat-{html.escape(c["slug"])}">'
        f'<h2>{html.escape(c["name"])}</h2>'
        f'<div class="eda-grid">{cards}</div>'
        '</section>'
    )

featured_html = "".join(card(p) for p in featured) or '<div class="eda-empty">Nessun articolo in evidenza.</div>'
latest_html = "".join(card(p) for p in latest) or '<div class="eda-empty">Nessun articolo disponibile.</div>'
archive_html = "".join(archive_sections) or '<div class="eda-empty">Nessun articolo pubblicato.</div>'

with open(template_path, "r", encoding="utf-8") as f:
    tpl = f.read()

updated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
content = (tpl
    .replace("__BLOG_INDEX_TITLE__", title)
    .replace("__BLOG_INDEX_INTRO__", intro)
    .replace("__BLOG_TOTAL_COUNT__", str(len(posts)))
    .replace("__BLOG_UPDATED_AT__", updated_at)
    .replace("__BLOG_FEATURED_CARDS__", featured_html)
    .replace("__BLOG_LATEST_CARDS__", latest_html)
    .replace("__BLOG_ARCHIVE_BY_CATEGORY__", archive_html)
    .replace("__BLOG_CATEGORIES_LIST__", categories_list)
)

print(content)
PY

content="$(cat "${tmp_render}")"

upsert_page "${BLOG_INDEX_SLUG}" "${BLOG_INDEX_TITLE}" "${content}" "${BLOG_INDEX_INTRO}" "${BLOG_INDEX_STATUS}" "${BLOG_INDEX_TEMPLATE}"

cat > "${OUT_FILE}" <<EOF
${content}
EOF

echo "Generated preview: ${OUT_FILE}"
echo "Blog hub URL: ${WP_BASE_URL%/}/${BLOG_INDEX_SLUG}/"
