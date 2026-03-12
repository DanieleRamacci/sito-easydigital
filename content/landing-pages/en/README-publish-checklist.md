# EN Landing Publish Checklist (No SEO Damage)

## 1) Create the page
- Recommended URL: `/en/italy-market-entry-digital-support/`
- Paste page body from:
  - `content/landing-pages/en/italy-market-entry-support-page.html`

## 2) Rank Math fields
- Focus keyword: `digital partner italy for foreign companies`
- SEO title: `Italy Market Entry Digital Support | Local Partner in Italy`
- Meta description:
  - `Launch and grow in Italy with a local digital partner: compliance-aware website setup, infrastructure, localization, local SEO and social media execution.`

Optional secondary keywords (in body, not as primary focus):
- `launch website in italy`
- `italy gdpr website compliance`
- `local seo italy`
- `digital agency italy for foreign companies`

## 3) Language and indexing
- Set page language to English (`lang="en"` via theme/plugin settings if available).
- Keep canonical self-referencing (canonical = EN page URL).
- Publish only when complete. If draft/incomplete, keep `noindex`.

## 4) Hreflang setup
- If you have an Italian equivalent page, connect both with alternate language links:
  - IT page -> `hreflang="it-IT"` + alternate EN
  - EN page -> `hreflang="en"` + alternate IT
- Do not canonical EN page to IT page.

## 5) Internal links
- Add link from IT home/services (small EN entry point, e.g. footer or top utility nav).
- Add link from EN landing to `/en/contact/` (or contact section in English).

## 6) Local SEO and compliance accuracy
- Avoid absolute claims like “data must stay in Italy”.
- Use safer wording:
  - “compliance-aware implementation”
  - “alignment with GDPR and local Italian practices”
  - “coordination with your legal advisors”

## 7) Post-publish validation
- Test:
  - HTTP 200
  - correct canonical
  - indexable status
  - title/meta visible in source
  - no duplicate URL version (with/without trailing slash)
