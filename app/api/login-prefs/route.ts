import { NextResponse } from "next/server";
import { clearLoginPrefs, readLoginPrefs, writeLoginPrefs } from "@/lib/login-prefs";

export async function GET() {
  const prefs = await readLoginPrefs();
  return NextResponse.json({ prefs });
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
    return NextResponse.json({ error: "Ongeldige gegevens." }, { status: 400 });
  }

  const method = body.method === "sso" || body.method === "password" ? body.method : null;
  const schoolUuid = body.schoolUuid?.trim();
  const schoolName = body.schoolName?.trim();
  const username = body.username?.trim();
  if (!schoolUuid || !schoolName || !username || !method) {
    return NextResponse.json(
      { error: "School, gebruikersnaam en inlogmethode zijn verplicht." },
      { status: 400 },
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
    return NextResponse.json({ prefs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Opslaan mislukt.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE() {
  await clearLoginPrefs();
  return NextResponse.json({ ok: true, prefs: null });
}
