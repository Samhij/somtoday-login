# Key shapes

Field lists are reconstructed from leerling store mappers (codegen `models/` is
absent from the published clone). Types in `cyfer-plugins/types/api.ts` mirror
the wire shapes for plugin authors.

---

## `RAccount` — `GET /account/me`

| Field | Notes |
| --- | --- |
| `gebruikersnaam` | Login name |
| `persoon` | `RLeerling` or `RVerzorger` (discriminate via `persoon.links[0].type`) |
| `additionalObjects.restricties.items[]` | `REloRestricties` |
| `additionalObjects.impersonated` | boolean |
| `additionalObjects.adres` | `RAdres` when requested |

### `REloRestricties` (feature flags)

Booleans (plus `leerlingId`):  
`mobieleAppAan`, `studiewijzerAan`, `berichtenVerzendenAan`, `leermiddelenAan`,
`adviezenTokenAan`, `opmerkingRapportCijferTonenAan`,
`periodeGemiddeldeTonenResultaatAan`, `rapportGemiddeldeTonenResultaatAan`,
`rapportCijferTonenResultaatAan`, `toetssoortgemiddeldenAan`, `seResultaatAan`,
`stamgroepLeerjaarAan`, `emailWijzigenAan`, `mobielWijzigenAan`,
`wachtwoordWijzigenAan`, `absentiesBekijkenAan`,
`absentieConstateringBekijkenAan`, `absentieMaatregelBekijkenAan`,
`absentieMeldingBekijkenAan`, `berichtenBekijkenAan`, `cijfersBekijkenAan`,
`huiswerkBekijkenAan`, `huiswerkWelNietInOrdeTonenAan`, `nieuwsBekijkenAan`,
`pasfotoLeerlingTonenAan`, `pasfotoMedewerkerTonenAan`, `profielBekijkenAan`,
`roosterBekijkenAan`, `roosterBeschikbaarIcalAan`, `vakkenBekijkenAan`,
`lesurenVerbergenSettingAan`, `magAbsentiemeldingMaken`.

### `RLeerling` (person / student entity)

`roepnaam`, `tussenvoegsel` / `voorvoegsel`, `achternaam`, `leerlingnummer`,
`geboortedatum`, `mobielNummer`, `email`, `pasfotoUrl`, `UUID`, `geslacht`, …

### `RAdres`

`straat`, `huisnummer`, `plaatsnaam`, `postcode`, `telefoonnummer`,
`isBuitenlandsAdres`, `land`, `buitenland1..3`.

---

## `RSchooljaar` — `GET /schooljaren/huidig`

Bare object: `naam`, `vanafDatum`, `totDatum`, `isHuidig`.

---

## `RAfspraakItem` — schedule week items

Top-level (unlike older `/afspraken`, vak is **not** only under additionalObjects):

| Field | Notes |
| --- | --- |
| `uniqueIdentifier` | Stable id string |
| `afspraakItemType` | `INDIVIDUEEL` \| `ROOSTER` \| `PRIVE` \| `BESCHERMD` \| `EXTERN` \| `OUDERAVOND` \| `EXAMEN` \| `ROOSTERTOETS` \| `ONBEKEND` |
| `beginDatumTijd` / `eindDatumTijd` | Local-wall ISO without timezone often |
| `beginLesuur` / `eindLesuur` | Optional period numbers |
| `titel`, `omschrijving`, `locatie` | |
| `vak` | `{ id?, afkorting, naam, UUID }` |
| `lesgroepen` | Mapped client-side to numeric `lesgroepIds` via links |
| `docentNamen` | `string[]` — mapped to `medewerkers` in the UI store |
| `herhalendeAfspraak` | Recurrence: begin/eind, `maxHerhalingen`, `type`, `skip`, `cyclus`, `afspraakHerhalingDagen` |
| `bijlagen` | With `assemblyResults` for downloads |
| `aantalToekomstigeHerhalingen` | |
| `$type` | `participatie.live.RKWTAfspraakItem` ⇒ KWT item |
| KWT fields | `inschrijfStatus`, `minimumAantalKeuzes`, `maximumAantalKeuzes`, `kwtSysteem`, `afspraakActies[]` |
| `status` / `wijzigingOmschrijving` / `statusNotifications` | Cancelled lessons often `status` `"4007"` or text like `"Les vervalt"` |

**KWT actie:** `titel`, `omschrijving`, `toegestaan`, `beschikbarePlaatsen`,
`locatie`, `docentNamen`, `ingeschreven`, inschrijf/begin/eind datums,
`uitvoerbareActie`, `vak`, `herhalendeAfspraak`.

**`inschrijfStatus`:** `ONBEPAALD` \| `NIET` \| `WEL` \| `DEFINITIEF` \| `VERLOPEN`.

Envelope may include `statusNotifications: [{ status?, message? }]`.

---

## `RVakantie`

List item: `naam`, `beginDatum`, `eindDatum`, plus entity `links`.  
Dates are whole-day timestamps (often with offset). Use the **calendar date**
part; avoid UTC day-shift when rendering bars.

---

## Berichten

### `RBoodschapConversatie`

| Field | Notes |
| --- | --- |
| `boodschappen` | `RBoodschap[]` (thread, oldest→newest or reverse — client uses `last()` as first message for id) |
| `datumOudsteOngelezenBoodschap` | ISO string; unread marker |
| `toekenningVanInleverperiode` | Optional SWI toekenning for hand-in threads |

### `RBoodschap`

| Field | Location |
| --- | --- |
| `verzendDatum`, `wijzigingsDatum`, `draft` | top-level |
| `onderwerp`, `inhoud`, `mimeType` | top-level |
| `prioriteit` | `URGENT` \| `HOOG` \| `NORMAAL` \| `LAAG` |
| `notificatieType` | large enum (`Bericht`, `Mededeling`, `Inlevering`, afspraak variants, …) |
| `bijlages` | **spelling with e** — attachment array |
| `verzondenDoorGebruiker` | `additionalObjects` |
| `verzenderCorrespondent` | `additionalObjects` → `{ naam, sorteerNaam, initialen, vakken[] }` |
| `ontvangerCorrespondenten` | `additionalObjects.items` |
| `aantalExtraOntvangers` | `additionalObjects` |
| `actiefVoorGebruiker` | `additionalObjects` — client maps `verwijderd = !actief` |
| `isOuderavondUitnodiging` | `additionalObjects` |

### `RMedewerker` (ontvangers)

`afkorting`, `achternaam`, `geslacht`, `voorvoegsel`, `voorletters`, `roepnaam`,
`additionalObjects.vakkenDocentVoorLeerling.items` → vakken.

---

## Studiewijzer toekenningen

Shared nested `studiewijzerItem`:

`onderwerp`, `huiswerkType` (`LESSTOF` \| `HUISWERK` \| `TOETS` \| `GROTE_TOETS`),
`omschrijving`, `toetsSoort`, `inleverperiodes`, `lesmateriaal`, `projectgroepen`,
`bijlagen`, `externeMaterialen`, `inlevermomenten[]` (`startGeldigheid`,
`eindGeldigheid`), `notitie`, `tijdsindicatie`, `leerdoelen`.

Afspraak/dag toekenningen: `datumTijd`, `sortering`.

**Additionals**

| Key | Content |
| --- | --- |
| `leerlingen` | `{ items: RLeerlingPrimer[] }` — filter to current student |
| `swigemaaktVinkjes` | `{ items: [{ leerling, gemaakt }] }` |
| `lesgroep` | `RLesgroep` (`naam`, `omschrijving`, `UUID`, `vak`) |
| `leerlingenMetInleveringStatus` | `{ items: [{ leerlingId, status, verzendDatum }] }` |
| `leerlingProjectgroep` | project group + members |
| `studiewijzerId` | scalar |

Inlever status: `TE_BEOORDELEN` \| `IN_BEHANDELING` \| `AKKOORD` \| `HEROPEND`.

---

## Plaatsingen & averages

### `RPlaatsing`

`UUID` (required for vakgemiddelden path), `vanafDatum`, `totDatum`, `huidig`,
`leerling`, `stamgroepnaam`, `opleidingsnaam`, `leerjaar`, `schooljaar.naam`,
`vestiging` `{ naam, uuid }`.

### `RVakkeuze`

`vak` `{ afkorting, naam, UUID }`, `vrijstelling`, `leerling.UUID`,
`relevanteCijferLichting.UUID` / `lichting`.

### `RLeerlingVakGemiddelden` (bare)

```ts
{
  gemiddelden?: Array<{
    vakkeuze?: RVakkeuze;
    vakAnderNiveau?: string;
    niveauOmschrijving?: string;
    afwijkendNiveauOmschrijving?: string;
    voortgangsdossierResultaat?: RGeldendResultaat;
    voortgangsdossierResultaatAfwijkend?: RGeldendResultaat;
    examendossierResultaat?: RGeldendResultaat;
  }>;
  voortgangsdossierGemiddelde?: number;
}
```

---

## `RGeldendResultaat` (grades)

Common fields used by mappers:

`isVoldoende`, `cijfer`, poging/herkansing fields, `periode`,
`formattedResultaat` (+ pogingen), `opmerkingen*`, `herkansingsnummer`,
`volgnummer`, `type`, `toetscode`, `omschrijving`, `weging`, `bijzonderheid`,
`datumInvoer*`, `herkansing`, `isLabel`, `isCijfer`, `toetssoort`,
`resultaatAnderVakKolom`, `label`, `labelAfkorting`,
`geldendResultaat` / `geldendResultaatCijferInvoer` (often absent — prefer
`formattedResultaat` / `cijfer` / `label`).

**Additionals:** `vaknaam`, `resultaatkolom`, `vakuuid`, `lichtinguuid`,
`leerjaar`, niveau names, `heeftalternatiefniveau`, `periodeAfkorting`.

Voortgang may also expose `*Alternatief` formatted/voldoende fields.

---

## Absentie

### `RAbsentieReden`

`absentieSoort` (`Absent` \| `Telaat` \| `Verwijderd`), `afkorting`,
`omschrijving`, `geoorloofd`, `kiesbaarDoorVerzorger`,
`verzorgerMagTijdstipKiezen`, `verzorgerEinddatumVerplicht`,
`standaardAfgehandeld`, `vestiging`.

### Registratie-overzicht (bare)

Groups: `afwezigWaarnemingen`, `geoorloofdAfwezig`, `ongeoorloofdAfwezig`,
`teLaat`, `verwijderd` (each with begin/eind/omschrijving/afgehandeld/afspraken),
plus `huiswerkNietGemaakt`, `materiaalNietInOrde`.
