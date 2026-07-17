import { NextResponse } from "next/server";
import { getSquareConfig } from "@/lib/env";
import { getSession } from "@/lib/session";

export async function POST() {
  const session = await getSession();
  session.destroy();
  const { appUrl } = getSquareConfig();
  return NextResponse.redirect(`${appUrl}/`, { status: 303 });
}

export async function GET() {
  return POST();
}
