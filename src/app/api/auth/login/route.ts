import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getAuthorizeUrl } from "@/lib/square";

export async function GET() {
  const state = randomBytes(24).toString("hex");
  const session = await getSession();
  session.oauthState = state;
  await session.save();

  return NextResponse.redirect(getAuthorizeUrl(state));
}
