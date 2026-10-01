import { NextResponse } from "next/server";
import { loadSchools } from "@/lib/schools";

export async function GET() {
  try {
    const schools = await loadSchools();
    return NextResponse.json({ schools });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load schools.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
