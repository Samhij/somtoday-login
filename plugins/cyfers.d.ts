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

/**
 * Raw Somtoday geldend voortgangs-/examendossier resultaat.
 * Prefer label / formattedResultaat / cijfer for display — geldendResultaat is often absent.
 */
type SomtodayGrade = {
  $type?: string;
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
