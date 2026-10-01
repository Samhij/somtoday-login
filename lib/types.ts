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
  name: string;
  studentNumber: string | null;
  email: string | null;
};

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
