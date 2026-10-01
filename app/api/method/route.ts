import { NextResponse } from "next/server";
import { detectSignIn } from "@/lib/somtoday";

export async function GET(request: Request) {
  const uuid = new URL(request.url).searchParams.get("uuid")?.trim();
  if (!uuid) return NextResponse.json({ error: "Choose a school first." }, { status: 400 });

  try {
    const method = await detectSignIn(uuid);
    return NextResponse.json({ method });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not detect the sign-in method.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
