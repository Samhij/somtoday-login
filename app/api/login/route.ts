import { NextResponse } from "next/server";
import { loadSchools } from "@/lib/schools";
import { writeSession } from "@/lib/session";
import { loginWithPassword, sessionFromTokens } from "@/lib/somtoday";

export async function POST(request: Request) {
  let body: { uuid?: string; username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Kies een school en vul je gebruikersnaam in." }, { status: 400 });
  }

  const uuid = body.uuid?.trim();
  const username = body.username?.trim();
  const password = body.password ?? "";
  if (!uuid || !username) {
    return NextResponse.json({ error: "Kies een school en vul je gebruikersnaam in." }, { status: 400 });
  }

  try {
    const schools = await loadSchools();
    const school = schools.find((item) => item.uuid === uuid);
    if (!school) {
      return NextResponse.json({ error: "Die school staat niet in de lijst." }, { status: 400 });
    }
    if (!password && school.providers.length === 0) {
      return NextResponse.json({ error: "Vul je wachtwoord in." }, { status: 400 });
    }
    const tokens = await loginWithPassword(school.uuid, username, password);
    const stored = sessionFromTokens(tokens, school.naam);
    await writeSession(stored);
    return NextResponse.json({
      ok: true,
      session: {
        schoolName: stored.schoolName,
        tenant: stored.tenant,
        schoolYear: null,
        students: [],
        grades: [],
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Inloggen mislukt.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
