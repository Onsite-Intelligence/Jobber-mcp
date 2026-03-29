/**
 * Jobber OAuth2 token management.
 *
 * Handles access token storage, automatic refresh on 401,
 * and logging of refreshed tokens for manual persistence.
 */

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix ms
}

let currentTokens: TokenSet | null = null;

const JOBBER_TOKEN_URL = "https://api.getjobber.com/api/oauth/token";

export function loadTokensFromEnv(): TokenSet {
  const accessToken = process.env.JOBBER_ACCESS_TOKEN;
  const refreshToken = process.env.JOBBER_REFRESH_TOKEN;

  if (!accessToken || !refreshToken) {
    throw new Error(
      "Missing JOBBER_ACCESS_TOKEN or JOBBER_REFRESH_TOKEN environment variables. " +
        "Set these after completing the Jobber OAuth flow."
    );
  }

  currentTokens = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + 55 * 60 * 1000, // assume ~55 min remaining on first load
  };

  return currentTokens;
}

export function getTokens(): TokenSet {
  if (!currentTokens) {
    return loadTokensFromEnv();
  }
  return currentTokens;
}

export async function refreshAccessToken(): Promise<TokenSet> {
  const clientId = process.env.JOBBER_CLIENT_ID;
  const clientSecret = process.env.JOBBER_CLIENT_SECRET;
  const tokens = getTokens();

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing JOBBER_CLIENT_ID or JOBBER_CLIENT_SECRET — cannot refresh token"
    );
  }

  const resp = await fetch(JOBBER_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Jobber token refresh failed (${resp.status}): ${body}. ` +
        "The user may need to re-authorize the app."
    );
  }

  const data = (await resp.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  currentTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  // Log refreshed tokens so the user can persist them
  console.error(
    "[jobber-mcp] Token refreshed. New tokens (save these if you want persistence):"
  );
  console.error(`  JOBBER_ACCESS_TOKEN=${data.access_token}`);
  console.error(`  JOBBER_REFRESH_TOKEN=${data.refresh_token}`);

  return currentTokens;
}

/**
 * Returns true if the access token is expired or will expire within 5 minutes.
 */
export function isTokenExpiringSoon(): boolean {
  const tokens = getTokens();
  return Date.now() > tokens.expiresAt - 5 * 60 * 1000;
}
