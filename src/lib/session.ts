import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { getSessionPassword } from "./env";

export type SquareSessionData = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  merchantId?: string;
  businessName?: string;
  oauthState?: string;
};

export function getSessionOptions(): SessionOptions {
  return {
    password: getSessionPassword(),
    cookieName: "square_bi_session",
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    },
  };
}

export async function getSession() {
  return getIronSession<SquareSessionData>(
    await cookies(),
    getSessionOptions(),
  );
}
