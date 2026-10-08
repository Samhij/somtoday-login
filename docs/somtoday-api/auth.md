# Authentication

Evidence: `libs/leerling/authentication/.../authentication.service.ts`,
`libs/leerling/environment/.../environment.ts`, root `openid-configuration`.

Auth is **not** under `/rest/v1`. The IdP is separate from the REST API host.

## Endpoints (IdP)

| Piece | Production value |
| --- | --- |
| Issuer | `https://inloggen.somtoday.nl` |
| Authorize | `{issuer}/oauth2/authorize` |
| Token | `{issuer}/oauth2/token` |
| Logout | `{issuer}/oauth2/logout` |
| Redirect (web) | `https://leerling.somtoday.nl/oauth/callback` |
| Redirect (native) | `somtoday://nl.topicus.somtoday.leerling/oauth/callback` |

## Client configuration (leerling app)

| Setting | Value |
| --- | --- |
| Client ID (web) | `somtoday-leerling-web` |
| Client ID (native) | `somtoday-leerling-native` |
| Flow | Authorization code (`responseType: "code"`) |
| Scope | `openid` |
| Custom token parameters | `somtoday_tenant`, `somtoday_api_url` |

Requested OIDC claims include `given_name`, `leerlingen`, `orgname`, and
`affiliation` ∈ `student` | `parent/guardian`.

Subject form: `{organisatieUUID}\{accountUUID}`.

### `leerlingen` claim

JSON string (parsed client-side) with a `.ll[]` array. Each entry typically has:

| Field | Meaning |
| --- | --- |
| `id` | Numeric student id |
| `gn` | Given / first name |
| `nn` | Family name |
| `nr` | Student number |
| `vestiging` | Optional campus |

## Token → REST

After token exchange:

1. Use `access_token` as `Authorization: Bearer …` on REST calls
2. Prefer `somtoday_api_url` from the token response as the API origin when
   present (Cyfers does this); otherwise `https://api.somtoday.nl`
3. `somtoday_tenant` identifies the school organisation

Cyfers mirrors this flow in `lib/somtoday.ts` (password + school SSO), stores
tokens server-side, and never exposes them to plugins.

## REST calls used during auth / session

| Method | Path | When |
| --- | --- | --- |
| `GET` | `/rest/v1/leerlingen/{id}` | Prefetch student (e.g. `pasfotoUrl`) |
| `POST` | `/rest/v1/account/deimpersonate` | Leave impersonation (empty body) |
| `PUT` | `/rest/v1/accountdevices` | Register push token `{ pushToken, deviceType }` |
| `DELETE` | `/rest/v1/accountdevices` | Clear devices on logout |
| `GET` | `/rest/v1/validate/googleplay?token=` | Play Integrity / device check |
| `GET` | `/rest/v1/validate/appledevicecheck?token=&keyId=` | Apple device check |

`deviceType` ∈ `IOS` | `ANDROID` | `WEB`.
