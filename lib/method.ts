import type { School, SignInMethod } from "./types";

export function signInMethod(school: School): SignInMethod {
  if (school.providers.length === 0) return { kind: "password" };
  return { kind: "sso", providers: school.providers };
}
