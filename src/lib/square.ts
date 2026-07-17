import { SquareClient, SquareEnvironment } from "square";
import { getSquareConfig, OAUTH_SCOPES } from "./env";

export function getSquareEnvironment() {
  const { environment } = getSquareConfig();
  return environment === "production"
    ? SquareEnvironment.Production
    : SquareEnvironment.Sandbox;
}

/** Client for OAuth token exchange (no seller token required). */
export function createOAuthClient() {
  return new SquareClient({
    environment: getSquareEnvironment(),
    auth: false,
  });
}

/** Authenticated client for a connected seller. */
export function createSellerClient(accessToken: string) {
  return new SquareClient({
    environment: getSquareEnvironment(),
    token: accessToken,
  });
}

export function getAuthorizeUrl(state: string): string {
  const { applicationId, redirectUri, environment } = getSquareConfig();
  const host =
    environment === "production"
      ? "https://connect.squareup.com"
      : "https://connect.squareupsandbox.com";

  const params = new URLSearchParams({
    client_id: applicationId,
    scope: OAUTH_SCOPES.join(" "),
    state,
  });

  // session=false is production-only; Sandbox always uses the seller session
  // from an open Sandbox Dashboard tab and ignores/rejects session=false.
  if (environment === "production") {
    params.set("session", "false");
  }

  // redirect_uri is only required for PKCE dynamic ports. Prefer the Redirect
  // URL registered in the Developer Console to avoid authorize 400s from
  // subtle mismatches. Still send it in production when explicitly configured.
  if (environment === "production" && redirectUri) {
    params.set("redirect_uri", redirectUri);
  }

  return `${host}/oauth2/authorize?${params.toString()}`;
}
