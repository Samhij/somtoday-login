# Cyfers plugins

Plugins zijn kleine zip-pakketten met een eigen UI. Cyfers regelt login bij
Somtoday; de plugin vraagt data alleen via de host-proxy.

Er zijn twee soorten:

- **page** – eigen item in de zijbalk
- **widget** – alleen op de Overzicht-pagina (geen zijbalk)

## Pakketstructuur

```
mijn-plugin/
  manifest.json
  ui/
    index.html
    # optioneel: app.js, style.css, …
```

Zip de map (of de inhoud) en upload die onder **Plugins** na het inloggen.
Maximaal 2 MB. Alleen `manifest.json` en bestanden onder `ui/` zijn toegestaan.

### Snel ontwikkelen (zonder zip)

Tijdens `npm run dev` (of met `CYFERS_PLUGIN_DEV_DIR`) toont Cyfers onder **Plugins →
Ontwikkeling** de mappen uit `../cyfer-plugins/plugins` (sibling-repo) of uit de
ingestelde ontwikkelmap. Klik **Laden** om de unpacked map te koppelen; **Herladen**
(of automatische file-watch) vernieuwt de plugin zonder opnieuw te zippen.

## manifest.json

### Pagina

```json
{
  "id": "mijn-plugin",
  "name": "Mijn plugin",
  "version": "1.0.0",
  "description": "Korte uitleg",
  "author": "Jouw naam",
  "kind": "page",
  "entry": "ui/index.html",
  "nav": {
    "label": "Zijbalknaam",
    "icon": "BookOpen",
    "order": 50
  },
  "permissions": {
    "api": ["/rest/v1/leerlingen"]
  }
}
```

### Widget

```json
{
  "id": "mijn-widget",
  "name": "Mijn widget",
  "version": "1.0.0",
  "description": "Blokje op Overzicht",
  "author": "Jouw naam",
  "kind": "widget",
  "entry": "ui/index.html",
  "nav": {
    "label": "Titel op Overzicht",
    "icon": "ChartColumn",
    "order": 10
  },
  "permissions": {
    "api": [
      "/rest/v1/geldendvoortgangsdossierresultaten/leerling/*",
      "/rest/v1/geldendexamendossierresultaten/leerling/*"
    ]
  }
}
```

- `kind`: `"page"` (standaard) of `"widget"`
- `id`: kebab-case, uniek
- `nav.icon`: Lucide-naam (PascalCase)
- `permissions.api`: glob-paden die met `/rest/` beginnen; `*` matcht binnen één segment

## HTML (`ui/index.html`)

Je schrijft gewone HTML/CSS/JS. Cyfers laadt het bestand in een sandboxed
iframe en injecteert automatisch:

1. **Basisstyling** – typografie, kleuren en helpers die bij de host passen
2. **Fonts** – IBM Plex Sans + Syne
3. **SDK** – `window.cyfers` (geen `<script>`-tag nodig)

Minimaal voorbeeld:

```html
<!DOCTYPE html>
<html lang="nl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mijn plugin</title>
  </head>
  <body>
    <h1>Mijn plugin</h1>
    <p class="lede" id="out">Laden…</p>
    <script>
      cyfers.getContext().then(function (ctx) {
        document.getElementById("out").textContent =
          "Hallo " + (ctx.students[0] && ctx.students[0].name
            ? ctx.students[0].name
            : "leerling");
      }).catch(function (err) {
        var out = document.getElementById("out");
        out.className = "error";
        out.textContent = err.message;
      });
    </script>
  </body>
</html>
```

### Wat je niet hoeft te doen

- Geen Cyfers-SDK handmatig laden.
- Geen host-kleuren of fonts hardcoden: die komen uit de basisstyling.
- Geen tokens of cookies uitlezen — die bereiken de iframe nooit.

### Assets koppelen

Relative paden worden herschreven naar de plugin-API:

```html
<link rel="stylesheet" href="style.css" />
<script src="app.js"></script>
<img src="logo.svg" alt="" />
```

Absolute `https://…` / `data:` / `#…`-URL’s blijven ongemoeid. Externe scripts
of stylesheets werken technisch, maar houd de zip zelfstandig.

### Layout per soort

| | page | widget |
| --- | --- | --- |
| Ruimte | volle contentkolom | klein blok op Overzicht |
| Body-padding | standaard (~1.25–1.5 rem) | compacter (`body.cyfers-widget`) |
| Advies | titel + inhoud | weinig chrome; laat `nav.label` de titel zijn |

### Meegeleverde CSS-tokens en helpers

Gebruik in eigen CSS of inline styles:

| Token / class | Betekenis |
| --- | --- |
| `--ink`, `--muted`, `--line` | tekst / secundair / randen |
| `--accent`, `--accent-soft` | merkkleur |
| `--bg-elevated`, `--danger`, `--danger-bg` | vlakken / fouten |
| `--font-body`, `--font-display` | body- en displayfont |
| `.lede` | korte introtekst |
| `.muted` / `.empty` | secundaire / lege staat |
| `.error` | foutmelding |

Licht/donker volgt het host-thema (`data-theme` op `<html>`). Eigen CSS
mag tokens overschrijven; doe dat spaarzaam.

De authoring-bron van deze stylesheet staat in
[`cyfer-plugins/styles`](https://github.com/Samhij/cyfer-plugins/tree/main/styles)
(`plugin-base.css`). Open die repo-root in VS Code / Cursor voor autocomplete op
`var(--…)` en helper-classes (via `.vscode/settings.json` + CSS/HTML custom data).
Kopieer of `@import` de base styles **niet** in je plugin-zip — de host injecteert
ze. De host houdt een vendored kopie bij (`npm run sync:plugin-styles`).

Voorbeeld eigen stylesheet:

```css
.row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem 1rem;
  padding: 0.7rem 0;
  border-bottom: 1px solid var(--line);
}

.row b {
  font-family: var(--font-display);
  color: var(--accent);
}
```

## TypeScript / CSS autocomplete

Plugin-facing types (SDK, `PluginManifest`, Somtoday REST-vormen) leven in de
marketplace-repo: [`cyfer-plugins/types`](https://github.com/Samhij/cyfer-plugins/tree/main/types).
Base CSS tokens/helpers: [`cyfer-plugins/styles`](https://github.com/Samhij/cyfer-plugins/tree/main/styles).
Open die **repo-root** in je editor voor:

- `cyfers.*` / `Somtoday*` — `jsconfig.json` + `types/`
- CSS-variabelen en helper-classes — `.vscode/settings.json` + `styles/*-custom-data.json`

De host houdt vendored kopieën bij onder `vendor/cyfer-plugin-types/`
(`npm run sync:plugin-types`) en `vendor/cyfer-plugin-styles/`
(`npm run sync:plugin-styles`).

## SDK (`window.cyfers`)

Wordt automatisch geïnjecteerd:

```js
const ctx = await cyfers.getContext();
// { schoolName, tenant, schoolYear, students }

const data = await cyfers.fetch("/rest/v1/leerlingen");
await cyfers.storage.set("key", "value");
const value = await cyfers.storage.get("key");
await cyfers.storage.remove("key");
```

- `getContext()` – school- en leerlinginfo (geen tokens).
- `fetch(path, init?)` – alleen paden uit jouw `permissions.api`; geeft JSON terug of gooit bij fout.
- `storage.*` – key/value in de host (`localStorage`), per plugin geïsoleerd.

Tokens zie je nooit. Alleen paden uit jouw `permissions.api` werken.

## Voorbeelden

- Widget: [widget-cijfers](https://github.com/Samhij/cyfer-plugins/tree/main/plugins/widget-cijfers) in de marketplace-repo
- Voorbeeldpagina: `plugins/voorbeeld-info` (lokaal sample) of dezelfde id in cyfer-plugins

## Beperkingen

- Plugins kunnen de React-shell van Cyfers niet aanpassen.
- Widgets verschijnen alleen op Overzicht; pages alleen in de zijbalk.
- Geen eigen servercode in de zip.
- Geen willekeurige externe API’s via de Cyfers-proxy.
- Iframe zonder `allow-same-origin`: geen cookies/DOM van de host, wel netwerk.
