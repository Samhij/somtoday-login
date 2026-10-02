/** Ambient types for Cyfers plugin scripts (injected `window.cyfers`). */

type CyfersStudent = {
  id: number;
  uuid: string | null;
  href: string | null;
  name: string;
  studentNumber: string | null;
  email: string | null;
};

type CyfersContext = {
  schoolName: string;
  tenant: string | null;
  schoolYear: string | null;
  students: CyfersStudent[];
};

type SomtodayLink = {
  id?: number | string;
  rel?: string;
  type?: string;
  href?: string;
};

type SomtodayPermission = {
  full?: string;
  type?: string;
  operations?: string[];
  instances?: string[];
};

type SomtodayEntity = {
  $type?: string;
  links?: SomtodayLink[];
  permissions?: SomtodayPermission[];
  additionalObjects?: Record<string, unknown>;
};

/** `GET /rest/v1/leerlingen` / `GET /rest/v1/leerlingen/{id}` item. */
type SomtodayStudent = SomtodayEntity & {
  UUID?: string;
  uuid?: string;
  roepnaam?: string;
  tussenvoegsel?: string;
  achternaam?: string;
  leerlingnummer?: number | string;
  email?: string;
  geboortedatum?: string;
  geslacht?: string;
  mobielNummer?: string;
  pasfotoUrl?: string;
};

/** `GET /rest/v1/schooljaren/huidig` (single object). */
type SomtodaySchooljaar = SomtodayEntity & {
  naam?: string;
  vanafDatum?: string;
  totDatum?: string;
  isHuidig?: boolean;
};

/**
 * Raw Somtoday geldend voortgangs-/examendossier resultaat.
 * Prefer label / formattedResultaat / cijfer for display — geldendResultaat is often absent.
 */
type SomtodayGrade = SomtodayEntity & {
  type?: string;
  resultaat?: string;
  geldendResultaat?: string | number;
  geldendResultaatCijferInvoer?: string | number;
  cijfer?: number;
  cijferEerstePoging?: number;
  label?: string;
  labelAfkorting?: string;
  formattedResultaat?: string;
  formattedEerstePoging?: string;
  isLabel?: boolean;
  isCijfer?: boolean;
  isVoldoende?: boolean;
  isVoldoendeEerstePoging?: boolean;
  periode?: number;
  volgnummer?: number;
  toetscode?: string;
  toetssoort?: string;
  weging?: number;
  herkansing?: string;
  omschrijving?: string;
  datumInvoer?: string;
  datumInvoerEerstePoging?: string;
  datumInvoerTweedePoging?: string;
  vak?: { naam?: string; afkorting?: string };
  additionalObjects?: {
    vaknaam?: string | { naam?: string; afkorting?: string };
    resultaatkolom?: string | { naam?: string; omschrijving?: string };
    naamalternatiefniveau?: string;
    vakuuid?: string;
    lichtinguuid?: string;
    [key: string]: unknown;
  };
};

type SomtodayVak = SomtodayEntity & {
  UUID?: string;
  uuid?: string;
  naam?: string;
  afkorting?: string;
};

type SomtodayAfspraakType = SomtodayEntity & {
  naam?: string;
  omschrijving?: string;
  standaardKleur?: number;
  categorie?: string;
  activiteit?: string;
  presentieRegistratieDefault?: boolean;
  actief?: boolean;
};

/** `GET /rest/v1/afspraken` item. */
type SomtodayAfspraak = SomtodayEntity & {
  beginDatumTijd?: string;
  eindDatumTijd?: string;
  beginLesuur?: number;
  eindLesuur?: number;
  titel?: string;
  omschrijving?: string;
  locatie?: string;
  afspraakStatus?: string;
  presentieRegistratieVerplicht?: boolean;
  presentieRegistratieVerwerkt?: boolean;
  bijlagen?: unknown[];
  afspraakType?: SomtodayAfspraakType;
  vestiging?: SomtodayEntity & { naam?: string; afkorting?: string; UUID?: string };
  additionalObjects?: {
    vak?: SomtodayVak;
    docentAfkortingen?: string;
    [key: string]: unknown;
  };
};

type SomtodayAbsentieReden = SomtodayEntity & {
  absentieSoort?: string;
  afkorting?: string;
  omschrijving?: string;
  geoorloofd?: boolean;
};

/** `GET /rest/v1/absentiemeldingen` item. */
type SomtodayAbsentieMelding = SomtodayEntity & {
  beginDatumTijd?: string;
  eindDatumTijd?: string;
  beginLesuur?: number;
  eindLesuur?: number;
  datumTijdInvoer?: string;
  afgehandeld?: boolean;
  leerling?: SomtodayStudent;
  absentieReden?: SomtodayAbsentieReden;
};

type SomtodayLesgroep = SomtodayEntity & {
  UUID?: string;
  uuid?: string;
  naam?: string;
  omschrijving?: string;
  schooljaar?: SomtodaySchooljaar;
};

/** `GET /rest/v1/studiewijzers` item. */
type SomtodayStudiewijzer = SomtodayEntity & {
  UUID?: string;
  uuid?: string;
  naam?: string;
  magBewerken?: boolean;
  vestiging?: SomtodayEntity & { naam?: string; afkorting?: string; UUID?: string };
  lesgroep?: SomtodayLesgroep;
  eigenaar?: unknown;
};

type SomtodayStudiewijzerItem = SomtodayEntity & {
  onderwerp?: string;
  huiswerkType?: string;
  omschrijving?: string;
  inleverperiodes?: boolean;
  lesmateriaal?: boolean;
  projectgroepen?: boolean;
  bijlagen?: unknown[];
  externeMaterialen?: unknown[];
  inlevermomenten?: unknown[];
  tonen?: boolean;
  notitieZichtbaarVoorLeerling?: boolean;
  leerdoelen?: string;
};

/** `GET /rest/v1/studiewijzeritemafspraaktoekenningen` item. */
type SomtodayStudiewijzerItemAfspraakToekenning = SomtodayEntity & {
  datumTijd?: string;
  aangemaaktOpDatumTijd?: string;
  sortering?: number;
  studiewijzerItem?: SomtodayStudiewijzerItem;
  lesgroep?: SomtodayLesgroep;
};

/** `GET /rest/v1/account` item. */
type SomtodayAccount = SomtodayEntity & {
  gebruikersnaam?: string;
  accountPermissions?: unknown[];
  persoon?: SomtodayStudent;
};

type SomtodayBoodschapCorrespondent = {
  $type?: string;
  naam?: string;
  sorteerNaam?: string;
  initialen?: string;
  vakken?: SomtodayVak[];
};

type SomtodayBoodschap = SomtodayEntity & {
  startPublicatie?: string;
  verzendDatum?: string;
  wijzigingsDatum?: string;
  draft?: boolean;
  onderwerp?: string;
  inhoud?: string;
  additionalObjects?: {
    aantalExtraOntvangers?: number;
    verzondenDoorGebruiker?: boolean;
    ontvangerCorrespondenten?: { $type?: string; items?: SomtodayBoodschapCorrespondent[] };
    verzenderCorrespondent?: SomtodayBoodschapCorrespondent;
    actiefVoorGebruiker?: boolean;
    isOuderavondUitnodiging?: boolean;
    [key: string]: unknown;
  };
};

/** `GET /rest/v1/boodschappen/conversaties` item. */
type SomtodayBoodschapConversatie = {
  $type?: string;
  boodschappen?: SomtodayBoodschap[];
  toekenningVanInleverperiode?: unknown;
};

type SomtodayListResponse<T> = {
  items?: T[];
};

declare const cyfers: {
  getContext(): Promise<CyfersContext>;
  fetch(path: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  }): Promise<unknown>;
  storage: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
    remove(key: string): Promise<unknown>;
  };
};
