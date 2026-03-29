/**
 * Jobber OAuth2 token management.
 *
 * Handles access token storage, automatic refresh on 401,
 * and persistence of refreshed tokens back to the .env file.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix ms
}

let currentTokens: TokenSet | null = null;

const JOBBER_TOKEN_URL = "https://api.getjobber.com/api/oauth/token";

// Resolve .env path relative to project root (works from src/ and dist/)
const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "..", "..", ".env");

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

  // Persist refreshed tokens to .env file
  persistTokensToEnv(data.access_token, data.refresh_token);

  // Also log to stderr as a fallback
  console.error("[jobber-mcp] Token refreshed successfully.");
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

/**
 * Write refreshed tokens back to the .env file so they survive restarts.
 * Falls back to stderr-only if the file doesn't exist or isn't writable.
 */
function persistTokensToEnv(accessToken: string, refreshToken: string): void {
  try {
    let content = readFileSync(ENV_PATH, "utf-8");

    content = content.replace(
      /^JOBBER_ACCESS_TOKEN=.*$/m,
      `JOBBER_ACCESS_TOKEN=${accessToken}`
    );
    content = content.replace(
      /^JOBBER_REFRESH_TOKEN=.*$/m,
      `JOBBER_REFRESH_TOKEN=${refreshToken}`
    );

    writeFileSync(ENV_PATH, content, "utf-8");
    console.error("[jobber-mcp] Tokens persisted to .env file.");
  } catch {
    console.error(
      "[jobber-mcp] Warning: could not write tokens to .env file — tokens logged to stderr only."
    );
  }
}
