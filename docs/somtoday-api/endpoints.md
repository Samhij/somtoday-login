# Endpoints

Paths are relative to `/rest/v1` unless noted. “Envelope” means list wrapper
`{ items }` vs bare object. Only endpoints **called by leerling-source** (store /
services) are listed in detail; codegen stubs that are unused at runtime are
summarised at the end.

---

## Account & rechten

| Method | Path | Envelope | Notes |
| --- | --- | --- | --- |
| `GET` | `/account/me` | bare `RAccount` | `additional=restricties` (rechten); also `impersonated`, `adres` |
| `PUT` | `/leerlingen/contactgegevens` | — | Body `{ mobielNummer, email }` |
| `PUT` | `/verzorgers/contactgegevens` | — | Body `{ mobielNummer, mobielWerkNummer, email }` |
| `GET` | `/accountsettings` | list | Notification toggles; client uses first item |
| `PUT` | `/accountsettings` | — | Same object as body |
| `GET` | `/icalendar` | bare | iCal link for student |
| `DELETE` | `/icalendar` | — | Revoke iCal |
| `GET` | `/leerlingen/toestemmingen` | list | Consent rows |
| `PUT` | `/leerlingen/{leerlingId}/toestemmingen/{veldUuid}` | — | Body = boolean |
| `PUT` | `/leerlingen/portaaltoestemmingen/{verzorgerId}` | — | Body = boolean |
| `POST` | `/account/deimpersonate` | — | Empty body |
| `PUT` | `/accountdevices` | — | Push registration |
| `DELETE` | `/accountdevices` | — | Clear devices |

**`GET /account/me` additionals used by leerling**

| `additional` | Shape under `additionalObjects` |
| --- | --- |
| `restricties` | `{ items: REloRestricties[] }` — per-student feature flags |
| `impersonated` | boolean |
| `adres` | `RAdres` |

Cyfers berichten plugin: `GET /account/me?additional=restricties` and reads
`berichtenBekijkenAan` / `berichtenVerzendenAan`.

---

## Leerlingen & schooljaar

| Method | Path | Envelope | Notes |
| --- | --- | --- | --- |
| `GET` | `/leerlingen` | list | Codegen; Cyfers host uses this for context |
| `GET` | `/leerlingen/{id}` | bare | Auth prefetch / detail |
| `GET` | `/leerlingen/{id}/schoolgegevens` | bare | Address, mentors, vestiging, … |
| `GET` | `/schooljaren` | list | Codegen |
| `GET` | `/schooljaren/huidig` | bare | Current year — Cyfers context |
| `GET` | `/schooljaren/{id}` | bare | Codegen |

---

## Rooster (afspraakitems) & vakanties

| Method | Path | Envelope | Notes |
| --- | --- | --- | --- |
| `GET` | `/afspraakitems/{leerlingId}/jaar/{jaar}/week/{week}` | list | ISO week-year + ISO week; optional `statusNotifications` |
| `POST` | `/afspraakitems/uitvoeren` | bare result | KWT enrol/unenroll |
| `GET` | `/afspraakitems/herhalingsinfo/{leerlingId}/{uitvoerbareActieId}` | list of dates | Recurrence preview |
| `GET` | `/vakanties/leerling/{leerlingId}` | list | School holidays |

**`POST /afspraakitems/uitvoeren` body**

```json
{
  "actie": "<uitvoerbareActie id/string>",
  "inschrijven": true,
  "kwtSysteem": "SOMTODAY",
  "leerlingId": 123,
  "jaar": 2026,
  "week": 12
}
```

(`kwtSysteem` ∈ `SOMTODAY` | `ZERMELO`.)

Response highlights: `foutmelding`, `afspraakItemWijzigingen[]`
(`afspraakItem`, `isVerwijderd`), `statusNotifications`.

---

## Berichten (boodschappen)

| Method | Path | Envelope | Notes |
| --- | --- | --- | --- |
| `GET` | `/boodschappen/conversaties` | list | Inbox/sent threads |
| `POST` | `/boodschappen/conversatie/{boodschapId}/markeerGelezen` | — | Empty body |
| `PUT` | `/boodschappen/setGelezen/{boodschapId}?gelezen=false` | — | Mark unread |
| `POST` | `/boodschappen/conversatie/{boodschapId}/verwijder` | — | Soft-delete for user |
| `GET` | `/boodschappen/conversatie/{id}/extraOntvangers` | list | Remaining recipients |
| `POST` | `/verstuurdbericht/nieuw?alsConversatieBoodschap=true` | — | Compose |
| `POST` | `/verstuurdbericht/reactie?alsConversatieBoodschap=true` | bare `RBoodschap` | Reply |
| `GET` | `/medewerkers/ontvangers` | list | Allowed recipients |

**Conversaties query**

```text
additional=verzondenDoorGebruiker
additional=verzenderCorrespondent
additional=ontvangerCorrespondenten
additional=aantalExtraOntvangers
additional=actiefVoorGebruiker
alle=true|false
```

(Constants in `bericht-model.ts`. Optional `alle` for full vs incremental fetch.)

**Medewerkers query:** `additional=vakkenDocentVoorLeerling`.

**Nieuw bericht body**

```json
{
  "onderwerp": "…",
  "inhoud": "…",
  "ontvangers": [
    { "links": [{ "id": 1, "rel": "self", "type": "medewerker.RMedewerkerPrimer" }] }
  ]
}
```

**Reactie body**

```json
{
  "inhoud": "…",
  "reactieOp": {
    "links": [{ "id": 99, "rel": "self", "type": "…" }]
  }
}
```

---

## Huiswerk / studiewijzer

Three parallel GETs per week (403 ignored when no studiewijzers yet):

| Method | Path | Week param | Shared params |
| --- | --- | --- | --- |
| `GET` | `/studiewijzeritemafspraaktoekenningen` | `jaarWeek={yyyy~ww}` | see below |
| `GET` | `/studiewijzeritemdagtoekenningen` | `jaarWeek={yyyy~ww}` | |
| `GET` | `/studiewijzeritemweektoekenningen` | `weeknummer={ww}` | |

Shared query:

- `geenDifferentiatieOfGedifferentieerdVoorLeerling={leerlingId}`
- `additional`: `leerlingen`, `swigemaaktVinkjes`, `lesgroep`,
  `leerlingenMetInleveringStatus`, `leerlingProjectgroep`, `studiewijzerId`

| Method | Path | Notes |
| --- | --- | --- |
| `PUT` | `/swigemaakt/cou` | Toggle “gemaakt” checkbox |
| `GET` | `/studiewijzeritemdagtoekenningen/inleverdetails/{toekenningId}` | Bare details |
| `POST` | `/studiewijzeritemdagtoekenningen/{id}/inleveren` | `{ uploadContextIds, urls }` |
| `POST` | `/studiewijzeritemdagtoekenningen/{id}/verstuurReactieLeerling` | Body = plain string |
| `DELETE` | `/studiewijzeritemdagtoekenningen/inlevering/{inleveringId}` | |
| `POST` | `/studiewijzeritemdagtoekenningen/inleveringen/accepteerLatestEULA` | Empty |
| `GET` | `/studiemateriaal/algemeen/{leerlingId}` | Materials |
| `GET` | `/studiemateriaal/{leerlingId}/vak\|lesgroep/{uuid}` | |
| `GET` | `/vakken/studiemateriaal/{leerlingId}` | |
| `PUT` | `/swgebruik/…` | Usage telemetry (several suffixes) |
| `POST` | `/transloadit/startUploadContext` | Upload bootstrap |

**`PUT /swigemaakt/cou` body**

```json
{
  "leerling": {
    "links": [
      { "id": 123, "rel": "self", "type": "leerling.RLeerlingPrimer" }
    ]
  },
  "swiToekenningId": 456,
  "gemaakt": true
}
```

Returns `RswiGemaakt` including `gemaakt`.

---

## Resultaten / plaatsingen / vakkeuzes

| Method | Path | Envelope | Notes |
| --- | --- | --- | --- |
| `GET` | `/plaatsingen?leerling={id}` | list | Path key for averages = **UUID** |
| `GET` | `/vakkeuzes?actiefOpPeildatum={date}&leerling={id}` | list | Subject choices |
| `GET` | `/vakkeuzes/plaatsing/{plaatsingUuid}/vakgemiddelden` | bare | Per-subject averages |
| `GET` | `/geldendvoortgangsdossierresultaten/leerling/{id}` | list | Latest voortgang |
| `GET` | `/geldendexamendossierresultaten/leerling/{id}` | list | Latest examen |
| `GET` | `/geldend…/vakresultaten/{id}/vak/{vakUuid}/lichting/{lichtingUuid}` | list | Per-subject grades |
| `GET` | `/geldend…/resultaatkolommen/{id}/vak/{vakUuid}/lichting/{lichtingUuid}` | list | Columns |
| `GET` | `/geldend…/leerling/{id}/deeltoetsen/{samengesteldeToetsId}` | list | Parts |
| `GET` | `/geldend…/leerling/{id}/samengesteldetoets/{deeltoetsId}` | — | Composite details |
| `GET` | `/geldendvoortgangsdossierresultaten/leerling/cijferoverzicht/{id}` | bare | Full overview |
| `GET` | `/geldendexamendossierresultaten/leerling/cijferoverzicht/{id}` | list | Examen overview |
| `GET` | `/geldendexamendossierresultaten/leerling/context/{id}` | list | Examenjaar / lichting |

**Latest-results shared query (leerling)**

- `type` ∈ `Toetskolom`, `DeeltoetsKolom`, `Werkstukcijferkolom`, `Advieskolom` (multi)
- `additional`: `vaknaam`, `resultaatkolom`, `naamalternatiefniveau`, `vakuuid`, `lichtinguuid`
- `sort=desc-geldendResultaatCijferInvoer`
- `Range: items=0-30`

Vakresultaten also pass `plaatsingUuid` and a richer `type` list (averages /
rapport / SE / …).

### Not called by leerling-source (Cyfers uses)

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/resultaatpublicatiemomenten/volgende/leerling/{id}` | Next delayed-grade publish moment; bare object |

---

## Absentie / registraties / maatregelen

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/absentieredenen` | `vestiging`, `leerling`; ignore 403 |
| `POST` | `/absentiemeldingen` | Body `{ items: [RAbsentieMeldingInvoer…] }` + `leerling` query |
| `GET` | `/leerlingen/{id}/registratieOverzicht?periode=` | Bare; periode enum below |
| `GET` | `/maatregeltoekenningen/actief/{leerlingId}` | Active measures |

`periode` ∈ `ZEVEN_DAGEN` | `DERTIG_DAGEN` | `CIJFERPERIODE` | `SCHOOLJAAR`.

**Absentie melding item `$type`:** `participatie.RAbsentieMeldingInvoer` with
`leerling`, `absentieReden`, `datumTijdInvoer`, `beginDatumTijd`, optional
`eindDatumTijd`, `opmerkingen`, `isHeleDagBeginDatum`, `isHeleDagEindDatum`.

---

## Ouderavond

| Method | Path | Envelope |
| --- | --- | --- |
| `GET` | `/ouderavond/{id}` | bare `ROuderavondData` |
| `POST` | `/ouderavond/{id}` | body `ouderavond.ROuderavondKeuzeInput` |

POST body includes `opmerkingVoorRoostermaker`, `verzoeken[]`, `keuzesHash`.

---

## Overige runtime calls

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/mededelingen` | Landelijke mededelingen |
| `GET` | `/appinfo/leerling/supported` | Supported app version (text) |

---

## Codegen-only (stubs present; not asserted as runtime)

OpenAPI operation stubs also declare CRUD-style paths for e.g. `/afspraken`,
`/waarnemingen`, `/actierealisaties`, `/studiewijzers`, `/swigemaakt`,
`/absentiemeldingen/{id}`, `/accountdevices/{id}`, generic
`/geldend*dossierresultaten`, `/vakkeuzes/{id}`, `/maatregelen`,
`/onderwijsopafstandperiodes`, adresseringen, etc. Prefer the runtime tables
above when wiring Cyfers plugins.
