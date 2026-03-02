#!/usr/bin/env python3
import base64
import csv
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / "content" / ".publish.env"
OUT_DIR = ROOT / "content" / "articles" / "census"
OUT_CSV = ROOT / "content" / "seo" / "articles-census.csv"


def read_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        env[k] = v
    return env


def strip_html(raw: str) -> str:
    no_tags = re.sub(r"<[^>]+>", " ", raw or "")
    no_ws = re.sub(r"\s+", " ", no_tags).strip()
    return html.unescape(no_ws)


def sanitize_filename(slug: str) -> str:
    safe = re.sub(r"[^a-z0-9\-]+", "-", slug.lower()).strip("-")
    return safe or "article"


def fetch_json(url: str, user: str, app_password: str, use_auth: bool = True):
    req = urllib.request.Request(url)
    if use_auth:
        token = base64.b64encode(f"{user}:{app_password}".encode("utf-8")).decode("ascii")
        req.add_header("Authorization", f"Basic {token}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8")
        headers = dict(resp.headers.items())
    return json.loads(body), headers


def get_primary_category(post: dict) -> tuple[str, str]:
    embedded = post.get("_embedded") or {}
    terms = embedded.get("wp:term") if isinstance(embedded, dict) else None
    if not isinstance(terms, list):
        return ("Generale", "generale")
    for group in terms:
        if not isinstance(group, list):
            continue
        for t in group:
            if isinstance(t, dict) and t.get("taxonomy") == "category":
                return (str(t.get("name") or "Generale"), str(t.get("slug") or "generale"))
    return ("Generale", "generale")


def article_to_md(post: dict, wp_base_url: str) -> str:
    slug = str(post.get("slug") or "")
    title_html = str((post.get("title") or {}).get("rendered") or "")
    excerpt_html = str((post.get("excerpt") or {}).get("rendered") or "")
    content_html = str((post.get("content") or {}).get("rendered") or "")
    sticky = bool(post.get("sticky"))
    status = str(post.get("status") or "publish")
    category_name, _ = get_primary_category(post)

    title = strip_html(title_html)
    excerpt = strip_html(excerpt_html) or title
    focus_kw = title.lower()
    canonical = f"{wp_base_url.rstrip('/')}/{slug}/"
    ai_entities = f"{title}, Easy Digital Agency, {category_name}"
    ai_prompt = f"Riassumi in italiano l'articolo '{title}' e indica quando e utile leggerlo."

    frontmatter = [
        f"slug: {slug}",
        f"title: {title}",
        f"category: {category_name}",
        f"featured: {'true' if sticky else 'false'}",
        f"excerpt: {excerpt}",
        "article_class: eda-articolo-censimento",
        f"seo_title: {title}",
        f"seo_description: {excerpt}",
        f"focus_keyword: {focus_kw}",
        f"canonical_url: {canonical}",
        f"ai_entities: {ai_entities}",
        f"ai_prompt: {ai_prompt}",
        "related_service_slugs:",
        "related_article_slugs:",
        "inline_links_html:",
        f"status: {status}",
        "",
        content_html.strip(),
        "",
    ]
    return "\n".join(frontmatter)


def main() -> int:
    if not ENV_FILE.exists():
        print(f"Missing env file: {ENV_FILE}", file=sys.stderr)
        return 1

    env = read_env(ENV_FILE)
    wp_base = env.get("WP_BASE_URL", "").rstrip("/")
    wp_user = env.get("WP_USERNAME", "")
    wp_password = env.get("WP_APP_PASSWORD", "")
    if not wp_base or not wp_user or not wp_password:
        print("Missing WP_BASE_URL / WP_USERNAME / WP_APP_PASSWORD in content/.publish.env", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)

    query = urllib.parse.urlencode(
        {
            "per_page": 100,
            "page": 1,
            "status": "publish",
            "_embed": 1,
            "_fields": ",".join(
                [
                    "id",
                    "date",
                    "slug",
                    "status",
                    "sticky",
                    "link",
                    "title.rendered",
                    "excerpt.rendered",
                    "content.rendered",
                    "_embedded.wp:term",
                ]
            ),
        }
    )
    first_url = f"{wp_base}/wp-json/wp/v2/posts?{query}"
    use_auth = True
    try:
        first_page, headers = fetch_json(first_url, wp_user, wp_password, use_auth=True)
    except urllib.error.HTTPError as exc:
        if exc.code != 401:
            raise
        print("Warning: WP auth failed (401). Continuing with public published posts only.")
        use_auth = False
        first_page, headers = fetch_json(first_url, wp_user, wp_password, use_auth=False)
    total_pages = int(headers.get("X-WP-TotalPages", "1") or "1")
    posts = list(first_page)
    for page in range(2, total_pages + 1):
        q = urllib.parse.urlencode(
            {
                "per_page": 100,
                "page": page,
                "status": "publish",
                "_embed": 1,
                "_fields": "id,date,slug,status,sticky,link,title.rendered,excerpt.rendered,content.rendered,_embedded.wp:term",
            }
        )
        arr, _ = fetch_json(f"{wp_base}/wp-json/wp/v2/posts?{q}", wp_user, wp_password, use_auth=use_auth)
        posts.extend(arr)

    posts.sort(key=lambda p: str(p.get("date") or ""), reverse=True)

    rows = []
    written = 0
    for post in posts:
        slug = str(post.get("slug") or "").strip()
        if not slug:
            continue
        title = strip_html(str((post.get("title") or {}).get("rendered") or ""))
        category_name, category_slug = get_primary_category(post)
        md = article_to_md(post, wp_base)
        out_file = OUT_DIR / f"{sanitize_filename(slug)}.md"
        out_file.write_text(md, encoding="utf-8")
        written += 1
        rows.append(
            {
                "id": str(post.get("id") or ""),
                "slug": slug,
                "title": title,
                "date": str(post.get("date") or ""),
                "status": str(post.get("status") or ""),
                "sticky": "true" if bool(post.get("sticky")) else "false",
                "category": category_name,
                "category_slug": category_slug,
                "link": str(post.get("link") or ""),
                "md_file": str(out_file.relative_to(ROOT)),
            }
        )

    with OUT_CSV.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=["id", "slug", "title", "date", "status", "sticky", "category", "category_slug", "link", "md_file"],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"Imported {written} posts to {OUT_DIR}")
    print(f"Wrote inventory: {OUT_CSV}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
