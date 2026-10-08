# Somtoday REST API (leerling client)

Documentation of the Somtoday API **as used by the official leerling web/native
client**, reverse-engineered from
[NONtoday/leerling-source](https://github.com/NONtoday/leerling-source)
(release snapshot) plus cross-checks against Cyfers host usage in this repo.

This is **not** an official Somtoday OpenAPI. The leerling clone ships OpenAPI
operation stubs under `libs/leerling/codegen/.../fn/operations/` but **omits**
the generated `models/` folder — field shapes below come from store mappers that
read `R*` properties (`libs/leerling/store/...`).

## Contents

| Doc | What |
| --- | --- |
| [conventions.md](./conventions.md) | Base URL, headers, envelopes, `additional`, pagination, identity |
| [auth.md](./auth.md) | OAuth2 / OIDC login, tokens, tenant + API URL claims |
| [endpoints.md](./endpoints.md) | Method + path catalog by domain (what leerling actually calls) |
| [shapes.md](./shapes.md) | Key request/response field shapes |

Plugin authors: prefer the typed shapes in the sibling
[`cyfer-plugins/types`](https://github.com/cyfers-somtoday/cyfer-plugins/tree/main/types)
package; keep `permissions.api` minimal.

## Quick facts

- REST root: `{somtoday_api_url}/rest/v1` (prod default `https://api.somtoday.nl/rest/v1`)
- Auth: Bearer access token from `inloggen.somtoday.nl` (see [auth.md](./auth.md))
- Content type: `application/vnd.topicus.platinum+json; charset=utf-8`
- Most list GETs return `{ items: T[] }`; some endpoints return a bare object
- Expanded data often arrives in `additionalObjects` when requested via
  `?additional=…`

## Cyfers proxy notes

Cyfers plugins never see tokens. They call `cyfers.fetch("/rest/v1/…")`; the host
proxies with the session token and enforces a per-plugin path allowlist. Paths in
this doc are the Somtoday paths (what goes into `permissions.api` and
`cyfers.fetch`).
