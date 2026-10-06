import { NextResponse } from "next/server";
import { clearLoginPrefs, readLoginPrefs, writeLoginPrefs } from "@/lib/login-prefs";

/** Never let Chromium disk-cache an empty prefs response across relaunches. */
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
};

export async function GET() {
  const prefs = await readLoginPrefs();
  return NextResponse.json({ prefs }, { headers: NO_STORE });
}

export async function PUT(request: Request) {
  let body: {
    schoolUuid?: string;
    schoolName?: string;
    schoolPlace?: string;
    username?: string;
    method?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige gegevens." }, { status: 400, headers: NO_STORE });
  }

  const method = body.method === "sso" || body.method === "password" ? body.method : null;
  const schoolUuid = body.schoolUuid?.trim();
  const schoolName = body.schoolName?.trim();
  const username = body.username?.trim();
  if (!schoolUuid || !schoolName || !username || !method) {
    return NextResponse.json(
      { error: "School, gebruikersnaam en inlogmethode zijn verplicht." },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const prefs = await writeLoginPrefs({
      schoolUuid,
      schoolName,
      schoolPlace: body.schoolPlace,
      username,
      method,
    });
    return NextResponse.json({ prefs }, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Opslaan mislukt.";
    return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE });
  }
}

export async function DELETE() {
  await clearLoginPrefs();
  return NextResponse.json({ ok: true, prefs: null }, { headers: NO_STORE });
}
