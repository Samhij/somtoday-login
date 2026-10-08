# Conventions

Evidence: `libs/leerling/environment`, `libs/leerling/request`,
`libs/leerling/store/.../util/abstract-state.ts`,
`libs/leerling/store/.../util/entiteit-model.ts`.

## Base URL

The leerling app builds the REST root as:

```text
https://api[.env].somtoday.nl/rest/v1
```

- Production: `https://api.somtoday.nl/rest/v1`
- Other deployments: `https://api.{config}.somtoday.nl/rest/v1` (or `.build` TLD
  for PR/nightly)
- Local ontwikkel: `http://{host}:8080/rest/v1`

`RequestService` concatenates `apiUrl + "/" + relativePath`. Relative paths in
store code omit the `/rest/v1` prefix (e.g. `"plaatsingen"`,
`"boodschappen/conversaties"`).

OAuth token responses may include custom parameters `somtoday_api_url` and
`somtoday_tenant`. Cyfers uses those for the session API origin; the leerling web
app’s `environment.apiUrl` is the primary REST base for that client.

## Headers

Default REST headers from `RequestService.getDefaultheaders()`:

| Header | Value |
| --- | --- |
| `Accept` | `application/vnd.topicus.platinum+json; charset=utf-8` |
| `Content-Type` | `application/vnd.topicus.platinum+json; charset=utf-8` |
| `Authorization` | `Bearer {access_token}` (via auth interceptor) |

Cyfers’ host proxy sets equivalent headers when calling Somtoday.

## Query helpers

Built by `RequestInformationBuilder`:

| Helper | Query / header | Notes |
| --- | --- | --- |
| `.additional(name)` / `.additionals(...)` | `additional` | Repeatable; expands nested data into `additionalObjects` |
| `.leerling(id)` | `leerling` | Scopes list endpoints to a student |
| `.sortAsc(prop)` / `.sortDesc(prop)` | `sort` | Values `asc-{prop}` / `desc-{prop}` |
| `.parameter(k, v)` | arbitrary | Arrays become repeated keys |
| `.header("Range", …)` | `Range` header | Pagination (`items={start}-{end}`) |
| `.body(...)` | JSON body | POST / PUT |

## Response envelopes

### List wrapper

Most collection GETs return:

```json
{
  "items": [ /* entities */ ],
  "statusNotifications": [ /* optional tips */ ]
}
```

`unwrappedGet` / `cachedUnwrappedGet` map this to `items` (default `[]`).

### Bare object

Some endpoints return a single entity (no `items`):

- `GET /schooljaren/huidig`
- `GET /account/me`
- `GET /vakkeuzes/plaatsing/{uuid}/vakgemiddelden`
- `GET /geldendvoortgangsdossierresultaten/leerling/cijferoverzicht/{id}`
- `GET /leerlingen/{id}/schoolgegevens`
- (Cyfers-only) `GET /resultaatpublicatiemomenten/volgende/leerling/{id}`

### Entity envelope

Entities commonly include:

```ts
{
  $type?: string;           // e.g. "participatie.RVakantie"
  links?: Array<{
    id?: number | string;
    rel?: string;           // "self", "koppeling", …
    type?: string;          // e.g. "leerling.RLeerlingPrimer"
    href?: string;
  }>;
  permissions?: Array<{
    full?: string;
    type?: string;
    operations?: string[];
    instances?: string[];
  }>;
  additionalObjects?: Record<string, unknown>;
  // … domain fields
}
```

**Identity:** leerling prefers `links[]` where `rel === "self"` (fallback
`koppeling`) for numeric ids. UUID fields are often top-level `UUID` (capital).

**Expanded data:** when `?additional=foo` is passed, nested payloads land under
`additionalObjects.foo` — either a scalar/object or `{ items: […] }`.

## Pagination

Automatic paging in `AbstractState`:

1. Read response header `Content-Range: items={start}-{end}/{total}`
2. Request next chunk with `Range: items={nextStart}-…`
3. Chunk size ≤ 100; max 5 chained requests

Example used for latest grades: `Range: items=0-30`.

## Path quirks

- **Afspraak week path in leerling-source** is built with **backslashes** in a
  template string (`afspraakitems\{id}\jaar\…`). Canonical HTTP paths (and
  Cyfers plugins) use **forward slashes**:
  `/rest/v1/afspraakitems/{leerlingId}/jaar/{isoYear}/week/{isoWeek}`.
- Leading `/` on relative paths is optional in `RequestService` (both
  `"boodschappen/…"` and `"/boodschappen/…"` appear).
