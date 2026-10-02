export type SsoProvider = {
  name: string;
  issuer: string;
};

export type School = {
  uuid: string;
  naam: string;
  plaats: string;
  providers: SsoProvider[];
};

export type SignInMethod =
  | { kind: "password" }
  | { kind: "sso"; providers: SsoProvider[] };

export type StudentInfo = {
  id: number;
  uuid: string | null;
  href: string | null;
  name: string;
  studentNumber: string | null;
  email: string | null;
};

/** Normalized grade for host UI (session overview). */
export type GradeInfo = {
  subject: string;
  result: string;
  date: string | null;
  description: string | null;
};

export type SessionInfo = {
  schoolName: string;
  tenant: string | null;
  schoolYear: string | null;
  students: StudentInfo[];
  grades: GradeInfo[];
};

/* —— Raw Somtoday REST shapes (live-checked) —— */

export type SomtodayLink = {
  id?: number | string;
  rel?: string;
  type?: string;
  href?: string;
};

export type SomtodayPermission = {
  full?: string;
  type?: string;
  operations?: string[];
  instances?: string[];
};

/** Common envelope on most Somtoday entities. */
export type SomtodayEntity = {
  $type?: string;
  links?: SomtodayLink[];
  permissions?: SomtodayPermission[];
  additionalObjects?: Record<string, unknown>;
};

/** `GET /rest/v1/leerlingen` / `GET /rest/v1/leerlingen/{id}` item. */
export type SomtodayStudent = SomtodayEntity & {
  UUID?: string;
  /** Rare; live responses use `UUID`. */
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

/** `GET /rest/v1/schooljaren/huidig` (single object, not wrapped in `items`). */
export type SomtodaySchooljaar = SomtodayEntity & {
  naam?: string;
  vanafDatum?: string;
  totDatum?: string;
  isHuidig?: boolean;
};

/**
 * Raw Somtoday geldend voortgangs-/examendossier resultaat.
 * Field names differ by dossier type; prefer helpers in lib/somtoday when reading.
 */
export type SomtodayGrade = SomtodayEntity & {
  type?: string;
  /** Voortgang-style result strings */
  resultaat?: string;
  geldendResultaat?: string | number;
  geldendResultaatCijferInvoer?: string | number;
  /** Examen-/label-style result fields (common on RGeldendExamendossierResultaat) */
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

/** `GET /rest/v1/vakken` item. */
export type SomtodayVak = SomtodayEntity & {
  UUID?: string;
  uuid?: string;
  naam?: string;
  afkorting?: string;
};

/** Nested afspraak type on roosters. */
export type SomtodayAfspraakType = SomtodayEntity & {
  naam?: string;
  omschrijving?: string;
  standaardKleur?: number;
  categorie?: string;
  activiteit?: string;
  presentieRegistratieDefault?: boolean;
  actief?: boolean;
};

/** `GET /rest/v1/afspraken` item. */
export type SomtodayAfspraak = SomtodayEntity & {
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

export type SomtodayAbsentieReden = SomtodayEntity & {
  absentieSoort?: string;
  afkorting?: string;
  omschrijving?: string;
  geoorloofd?: boolean;
};

/** `GET /rest/v1/absentiemeldingen` item. */
export type SomtodayAbsentieMelding = SomtodayEntity & {
  beginDatumTijd?: string;
  eindDatumTijd?: string;
  beginLesuur?: number;
  eindLesuur?: number;
  datumTijdInvoer?: string;
  afgehandeld?: boolean;
  leerling?: SomtodayStudent;
  absentieReden?: SomtodayAbsentieReden;
};

export type SomtodayLesgroep = SomtodayEntity & {
  UUID?: string;
  uuid?: string;
  naam?: string;
  omschrijving?: string;
  schooljaar?: SomtodaySchooljaar;
};

/** `GET /rest/v1/studiewijzers` item. */
export type SomtodayStudiewijzer = SomtodayEntity & {
  UUID?: string;
  uuid?: string;
  naam?: string;
  magBewerken?: boolean;
  vestiging?: SomtodayEntity & { naam?: string; afkorting?: string; UUID?: string };
  lesgroep?: SomtodayLesgroep;
  eigenaar?: unknown;
};

export type SomtodayStudiewijzerItem = SomtodayEntity & {
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
export type SomtodayStudiewijzerItemAfspraakToekenning = SomtodayEntity & {
  datumTijd?: string;
  aangemaaktOpDatumTijd?: string;
  sortering?: number;
  studiewijzerItem?: SomtodayStudiewijzerItem;
  lesgroep?: SomtodayLesgroep;
};

/** `GET /rest/v1/account` item. */
export type SomtodayAccount = SomtodayEntity & {
  gebruikersnaam?: string;
  accountPermissions?: unknown[];
  persoon?: SomtodayStudent;
};

export type SomtodayBoodschapCorrespondent = {
  $type?: string;
  naam?: string;
  sorteerNaam?: string;
  initialen?: string;
  vakken?: SomtodayVak[];
};

export type SomtodayBoodschap = SomtodayEntity & {
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
export type SomtodayBoodschapConversatie = {
  $type?: string;
  boodschappen?: SomtodayBoodschap[];
  toekenningVanInleverperiode?: unknown;
};

export type SomtodayListResponse<T> = {
  items?: T[];
};
