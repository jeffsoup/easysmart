import { NextRequest, NextResponse } from "next/server";
import { getSquareConfig } from "@/lib/env";
import { getSession } from "@/lib/session";
import { createOAuthClient, createSellerClient } from "@/lib/square";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const { appUrl } = getSquareConfig();

  if (error) {
    return NextResponse.redirect(
      `${appUrl}/?error=${encodeURIComponent(error)}`,
    );
  }

  const session = await getSession();

  if (!code || !state || state !== session.oauthState) {
    return NextResponse.redirect(
      `${appUrl}/?error=${encodeURIComponent("invalid_oauth_state")}`,
    );
  }

  const { applicationId, applicationSecret, redirectUri } = getSquareConfig();
  const oauthClient = createOAuthClient();

  try {
    const tokenResponse = await oauthClient.oAuth.obtainToken({
      clientId: applicationId,
      clientSecret: applicationSecret,
      code,
      grantType: "authorization_code",
      redirectUri,
    });

    if (!tokenResponse.accessToken) {
      return NextResponse.redirect(
        `${appUrl}/?error=${encodeURIComponent("missing_access_token")}`,
      );
    }

    const sellerClient = createSellerClient(tokenResponse.accessToken);
    const merchants = await sellerClient.merchants.list();
    const merchant = merchants.data[0];

    session.accessToken = tokenResponse.accessToken;
    session.refreshToken = tokenResponse.refreshToken;
    session.expiresAt = tokenResponse.expiresAt;
    session.merchantId = merchant?.id ?? tokenResponse.merchantId;
    session.businessName = merchant?.businessName ?? "Square seller";
    session.oauthState = undefined;
    await session.save();

    return NextResponse.redirect(`${appUrl}/dashboard`);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "oauth_token_exchange_failed";
    return NextResponse.redirect(
      `${appUrl}/?error=${encodeURIComponent(message)}`,
    );
  }
}
