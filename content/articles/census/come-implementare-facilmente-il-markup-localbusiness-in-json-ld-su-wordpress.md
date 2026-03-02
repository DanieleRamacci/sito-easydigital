slug: come-implementare-facilmente-il-markup-localbusiness-in-json-ld-su-wordpress
title: Come implementare facilmente il markup LocalBusiness in JSON-LD su WordPress
category: Generale
featured: false
excerpt: Come migliorare la tua Local SEO con lo schema markup LocalBusiness in JSON-LD Se hai un’attività locale e vuoi essere trovato su Google e Google…
article_class: eda-articolo-censimento
seo_title: Come implementare facilmente il markup LocalBusiness in JSON-LD su WordPress
seo_description: Come migliorare la tua Local SEO con lo schema markup LocalBusiness in JSON-LD Se hai un’attività locale e vuoi essere trovato su Google e Google…
focus_keyword: come implementare facilmente il markup localbusiness in json-ld su wordpress
canonical_url: https://www.easydigitalagency.it/come-implementare-facilmente-il-markup-localbusiness-in-json-ld-su-wordpress/
ai_entities: Come implementare facilmente il markup LocalBusiness in JSON-LD su WordPress, Easy Digital Agency, Generale
ai_prompt: Riassumi in italiano l'articolo 'Come implementare facilmente il markup LocalBusiness in JSON-LD su WordPress' e indica quando e utile leggerlo.
related_service_slugs:
related_article_slugs:
inline_links_html:
status: publish

<div data-elementor-type="wp-post" data-elementor-id="2562" class="elementor elementor-2562" data-elementor-post-type="post">
				<div class="elementor-element elementor-element-e4f3493 e-flex e-con-boxed e-con e-parent" data-id="e4f3493" data-element_type="container" data-e-type="container">
					<div class="e-con-inner">
				<div class="elementor-element elementor-element-21de889 elementor-widget elementor-widget-text-editor" data-id="21de889" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<h1>Come migliorare la tua Local SEO con lo schema markup LocalBusiness in JSON-LD</h1><p>Se hai un&#8217;attività locale e vuoi essere trovato su Google e Google Maps, è fondamentale implementare uno <strong>schema markup LocalBusiness in JSON-LD</strong> sul tuo sito web. In questa guida ti spieghiamo cos&#8217;è, come implementarlo correttamente e perché collegarlo al tuo profilo Google Business è una mossa vincente per la Local SEO.</p><p><a href="https://developers.google.com/search/docs/appearance/structured-data/local-business?hl=it" target="_blank" rel="noopener">Qui un riferimento alla documentazione ufficiale Google </a></p><div style="font-weight: bold; color: #50c878; margin-bottom: 10px; font-size: 14px; text-transform: uppercase;">💡 Consiglio di EasyDigitalAgency</div><h3 style="margin-top: 0;">Se hai wordpress vai direttamente al paragrafo:</h3><ul><li><a href="#wordpress">Come implementarlo facilmente in WordPress</a></li></ul><hr /><h2>Indice dei contenuti</h2><ul><li><a href="#cos-e">Cos’è lo schema LocalBusiness e perché è utile</a></li><li><a href="#come-funziona">Come funziona il markup LocalBusiness in JSON-LD</a></li><li><a href="#dove-inserirlo">Dove inserire il markup nel sito</a></li><li><a href="#wordpress">Come implementarlo facilmente in WordPress</a></li><li><a href="#collegamento-gmb">Come collegare il sito al profilo Google Business</a></li><li><a href="#vantaggi">I vantaggi concreti per la Local SEO</a></li><li><a href="#conclusione">Conclusioni</a></li></ul><hr /><h2 id="cos-e">Cos’è lo schema LocalBusiness e perché è utile</h2><p>Lo <strong>schema markup LocalBusiness</strong> è un tipo di dato strutturato che fornisce a Google informazioni dettagliate sulla tua attività locale, come nome, indirizzo, telefono, orari di apertura, URL del sito e profili social. Aiuta a migliorare la visibilità nelle ricerche locali e nei rich snippet.</p><h2 id="come-funziona">Come funziona il markup LocalBusiness in JSON-LD</h2><p>Il formato <strong>JSON-LD</strong> (JavaScript Object Notation for Linked Data) è il metodo consigliato da Google per inserire i dati strutturati nelle pagine web. Ecco un esempio di codice:</p><pre><code>&lt;script type="application/ld+json"&gt;
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Easy Digital Agency",
  "image": "https://easydigitalagency.it/logo.png",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Via Esempio 123",
    "addressLocality": "Roma",
    "addressRegion": "RM",
    "postalCode": "00100",
    "addressCountry": "IT"
  },
  "url": "https://easydigitalagency.it",
  "telephone": "+39 06 1234567",
  "openingHours": "Mo-Fr 09:00-18:00",
  "sameAs": [
    "https://www.facebook.com/easydigitalagency",
    "https://www.instagram.com/easydigitalagency"
  ]
}
&lt;/script&gt;</code></pre><h2 id="dove-inserirlo">Dove inserire il markup nel sito</h2><p>Il codice può essere inserito:</p><ul><li>Nella <code>&lt;head&gt;</code> della homepage</li><li>Oppure appena prima della chiusura del <code>&lt;/body&gt;</code></li></ul><p>Per verificare la correttezza del markup, usa il <a href="https://search.google.com/test/rich-results" target="_blank" rel="noopener">Rich Results Test di Google</a>.</p><aside style="border-left: 5px solid #FFA500; background-color: #fff8e6; padding: 20px; margin-top: 30px; margin-bottom: 30px; border-radius: 5px;"><div style="font-weight: bold; color: #ffa500; margin-bottom: 10px; font-size: 14px; text-transform: uppercase;">🔧 Sezione Tecnica Avanzata</div><h3 style="margin-top: 0;">Schema LocalBusiness: campi consigliati da Google</h3><p>Google consiglia di includere alcuni campi chiave per aumentare la visibilità locale:</p><ul><li><strong>name</strong>: nome commerciale dell’attività</li><li><strong>address</strong>: struttura completa (via, città, CAP)</li><li><strong>openingHours</strong>: orari di apertura</li><li><strong>url e telephone</strong>: contatti aggiornati</li><li><strong>sameAs</strong>: profili social</li></ul><p>⚠️ Evita informazioni non coerenti con quelle su Google Business Profile. La coerenza è fondamentale.</p></aside><h2 id="wordpress">Come implementarlo facilmente in WordPress</h2><p>Se usi WordPress, inserire il <strong>markup LocalBusiness in JSON-LD</strong> è semplice e non richiede competenze tecniche avanzate. Ecco due metodi:</p><h3>🔌 Metodo 1 – Usare un plugin SEO (consigliato)</h3><ul><li><strong>Rank Math</strong>: vai su Impostazioni &gt; Titoli &amp; Meta &gt; Local SEO e compila i campi.</li><li><strong>Yoast SEO</strong>: con estensione premium per Local SEO.</li></ul><h3>📝 Metodo 2 – Inserimento manuale del codice</h3><ol><li>Vai su <em>Aspetto &gt; Editor del tema</em> o usa <strong>Insert Headers and Footers</strong></li><li>Incolla lo script JSON-LD nella sezione <code>head</code></li><li>Verifica il markup con <a href="https://search.google.com/test/rich-results" target="_blank" rel="noopener">Google Rich Results Test</a></li></ol><aside style="border-left: 5px solid #50c878; background-color: #f0fff4; padding: 20px; margin-top: 30px; margin-bottom: 30px; border-radius: 5px;"><div style="font-weight: bold; color: #50c878; margin-bottom: 10px; font-size: 14px; text-transform: uppercase;">💡 Consiglio di EasyDigitalAgency</div><h3 style="margin-top: 0;">Preferisci non toccare il codice?</h3><p>Se vuoi implementare il markup LocalBusiness senza rischi, possiamo farlo noi per te. Ottimizziamo il tuo sito WordPress e lo colleghiamo correttamente a Google. Ti basta <a href="/contatti">scriverci qui</a>.</p></aside><h2 id="collegamento-gmb">Come collegare il sito al profilo Google Business</h2><ul><li>Inserisci l’URL del tuo sito nella scheda GMB</li><li>Nel JSON-LD inserisci il campo <code>"url"</code> con il link del tuo sito</li><li>Assicurati che NAP (nome, indirizzo, telefono) sia identico su sito e GMB</li><li>Aggiungi link alla scheda GMB nel footer o nella pagina contatti</li></ul><h2 id="vantaggi">I vantaggi concreti per la Local SEO</h2><ul><li>Più visibilità su Google Maps</li><li>Rich snippet migliorati (stelle, orari, info)</li><li>Più fiducia da parte di Google e degli utenti</li><li>Migliore corrispondenza tra query locali e risultati</li></ul><h2 id="conclusione">Conclusioni</h2><p>Lo schema markup <strong>LocalBusiness in JSON-LD</strong> è uno strumento semplice ma potente per aumentare la tua visibilità locale. Integrarlo nel tuo sito e collegarlo al profilo GMB ti consente di ottenere risultati migliori nella Local SEO in modo gratuito e duraturo.</p><p><strong>Hai bisogno di aiuto?</strong> <a href="/contatti">Contattaci per una consulenza gratuita</a>.</p>								</div>
				</div>
					</div>
				</div>
				</div>
