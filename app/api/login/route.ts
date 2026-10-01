import { NextResponse } from "next/server";
import { loadSchools } from "@/lib/schools";
import { writeSession } from "@/lib/session";
import { loginWithPassword, sessionFromTokens } from "@/lib/somtoday";

export async function POST(request: Request) {
  let body: { uuid?: string; username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Choose a school and enter a username." }, { status: 400 });
  }

  const uuid = body.uuid?.trim();
  const username = body.username?.trim();
  const password = body.password ?? "";
  if (!uuid || !username) {
    return NextResponse.json({ error: "Choose a school and enter a username." }, { status: 400 });
  }

  try {
    const schools = await loadSchools();
    const school = schools.find((item) => item.uuid === uuid);
    if (!school) {
      return NextResponse.json({ error: "That school is not in the Somtoday list." }, { status: 400 });
    }
    if (!password && school.providers.length === 0) {
      return NextResponse.json({ error: "Enter the password for this school." }, { status: 400 });
    }
    const tokens = await loginWithPassword(school.uuid, username, password);
    await writeSession(sessionFromTokens(tokens, school.naam));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-in failed.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
