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

## SDK (`window.cyfers`)

Wordt automatisch geïnjecteerd:

```js
const ctx = await cyfers.getContext();
// { schoolName, tenant, schoolYear, students }

const data = await cyfers.fetch("/rest/v1/leerlingen");
await cyfers.storage.set("key", "value");
```

Tokens zie je nooit. Alleen paden uit jouw `permissions.api` werken.

## Voorbeelden

- Ingebouwde widget: `plugins/widget-cijfers`
- Voorbeeldpagina: `plugins/voorbeeld-info`

## Beperkingen

- Plugins kunnen de React-shell van Cyfers niet aanpassen.
- Widgets verschijnen alleen op Overzicht; pages alleen in de zijbalk.
- Geen eigen servercode in de zip.
- Geen willekeurige externe API’s via de Cyfers-proxy.
