# Content Publish Commands

Questa guida raccoglie i comandi rapidi per pubblicare servizi/articoli su WordPress.

## Prerequisiti

- File `content/.publish.env` compilato con:
  - `WP_BASE_URL`
  - `WP_USERNAME`
  - `WP_APP_PASSWORD`
- Script eseguibili (se necessario):

```bash
chmod +x scripts/publish-content.sh scripts/publish-services.sh scripts/publish-articles.sh scripts/publish-blog-index.sh scripts/build-content-graph.sh
```

## 1) Publish completo (servizi + articoli + blog hub + graph)

```bash
./scripts/publish-content.sh
```

## 2) Publish solo servizi

```bash
./scripts/publish-services.sh
```

## 3) Publish solo articoli

```bash
./scripts/publish-articles.sh
```

## 4) Rigenera solo pagina indice blog

```bash
./scripts/publish-blog-index.sh
```

## 5) Rigenera solo grafo SEO locale

```bash
./scripts/build-content-graph.sh
```

## 6) Esecuzione via GitHub Action (opzionale)

Workflow: `Publish Services Pages`

Comando GitHub CLI:

```bash
gh workflow run "Publish Services Pages"
```

## 7) Check rapidi post publish

Sostituisci URL con gli slug da verificare:

```bash
curl -I https://www.easydigitalagency.it/servizi-digital-web-agency/
curl -I https://www.easydigitalagency.it/quanto-costa-farsi-realizzare-un-sito-web/
curl -I https://www.easydigitalagency.it/articoli-e-guide-digitali/
```

## 8) Pulizia cache (se vedi contenuti vecchi)

- Svuota cache plugin (WP Rocket)
- Svuota Redis:

```bash
redis-cli FLUSHALL
```


consulenza-e-formazione-digitale | keyword: consulenza e formazione digitale | intent: commerciale

consulenza-tecnico-informatica | keyword: consulenza tecnico informatica | intent: commerciale
consulenza-informatica-per-avvocati | keyword: consulenza informatica per avvocati | intent: commerciale
raccolta-prove-digitali | keyword: raccolta prove digitali | intent: commerciale/informativo
integrazione-api-e-automazioni | keyword: integrazione api e automazioni | intent: commerciale
plugin-wordpress-personalizzati | keyword: plugin wordpress personalizzati | intent: commerciale
privacy-policy-gdpr | keyword: privacy policy gdpr | intent: informativo/commerciale
progetti-digitali-avanzati | keyword: progetti digitali avanzati | intent: commerciale
strategia-social-media | keyword: strategia social media | intent: commerciale
landing-page-ottimizzate-per-conversioni | keyword: landing page ottimizzate per conversioni | intent: commerciale
sicurezza-wordpress | keyword: sicurezza wordpress | intent: commerciale/informativo
web-marketing-strategico | keyword: web marketing strategico | intent: commerciale
seo-e-posizionamento-su-google | keyword: seo e posizionamento su google | intent: commerciale
gestione-annuale-sito-web-assistenza-tecnica | keyword: gestione annuale sito web | intent: commerciale
realizzazione-siti-web-professionali-roma | keyword: realizzazione sito web a roma | intent: commerciale