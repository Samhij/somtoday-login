/**
 * Host-facing session / school types, plus re-exports of plugin-facing
 * Somtoday REST shapes from the vendored cyfer-plugins types.
 *
 * Plugin SDK / REST type source of truth: cyfer-plugins/types/
 * (synced into vendor/cyfer-plugin-types/ via scripts/sync-plugin-types.js).
 */

export type {
  CyfersContext,
  CyfersFetchInit,
  CyfersSdk,
  CyfersStudent,
  PluginKind,
  PluginManifest,
  PluginNav,
  SomtodayAbsentieMelding,
  SomtodayAbsentieReden,
  SomtodayAccount,
  SomtodayAfspraak,
  SomtodayAfspraakType,
  SomtodayBoodschap,
  SomtodayBoodschapConversatie,
  SomtodayBoodschapCorrespondent,
  SomtodayEntity,
  SomtodayGrade,
  SomtodayLesgroep,
  SomtodayLink,
  SomtodayListResponse,
  SomtodayPermission,
  SomtodaySchooljaar,
  SomtodayStudent,
  SomtodayStudiewijzer,
  SomtodayStudiewijzerItem,
  SomtodayStudiewijzerItemAfspraakToekenning,
  SomtodayVak,
} from "../vendor/cyfer-plugin-types/api";

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

/** Normalized student for host UI (same fields as plugin CyfersStudent). */
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
