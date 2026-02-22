# Regole Editoriali Articoli (Source of Truth)

Queste regole valgono per tutti i nuovi articoli e per gli aggiornamenti.

## 1) Risposta immediata in apertura

- Ogni articolo deve aprire con una sezione tipo:
  - `Risposta breve`
  - `In sintesi`
  - `La risposta in 20 secondi`
- L'utente deve trovare subito la risposta principale senza dover leggere tutto.

## 2) Sommario con anchor link

- Dopo la risposta breve deve esserci sempre un sommario con link interni.
- Ogni sezione importante deve avere un anchor `id` stabile.
- Il sommario deve riflettere la struttura reale dell'articolo.

## 3) Struttura SEO minima

- Un solo `h1` (titolo articolo).
- `h2` per macro-sezioni; `h3` per dettagli.
- Meta compilati nel front matter:
  - `seo_title`
  - `seo_description`
  - `focus_keyword`
  - `canonical_url` (quando noto)

## 4) Intento di ricerca

- Ogni articolo deve rispondere all'intento principale entro il primo scroll.
- La parte successiva approfondisce:
  - come funziona
  - quando conviene
  - costi/tempi/alternative
  - errori comuni

## 5) Collegamenti interni

- Ogni articolo deve puntare ad almeno:
  - 1 pagina servizio correlata
  - 1 eventuale articolo correlato (se disponibile)
- Usare `related_service_slugs`, `related_article_slugs`, `inline_links_html`.

## 6) Tabelle e dati leggibili da AI

- Se l'articolo tratta prezzi, confronti o checklist:
  - includere una tabella HTML o Markdown pulita
  - colonne chiare (`servizio`, `prezzo`, `incluso`, `target`).

## 7) Tone of voice

- Linguaggio chiaro, concreto, senza gergo inutile.
- Frasi orientate a decisione pratica (cosa fare dopo).

