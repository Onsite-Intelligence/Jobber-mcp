/**
 * Error handling utilities for Jobber GraphQL API responses.
 *
 * Maps raw GraphQL errors and userErrors into clear, actionable messages
 * that Claude (or any MCP consumer) can understand and act on.
 */

export class JobberAPIError extends Error {
  public readonly statusCode: number | undefined;
  public readonly graphqlErrors: unknown[];
  public readonly userErrors: Array<{ message: string; path?: string[] }>;

  constructor(
    message: string,
    opts?: {
      statusCode?: number;
      graphqlErrors?: unknown[];
      userErrors?: Array<{ message: string; path?: string[] }>;
    }
  ) {
    super(message);
    this.name = "JobberAPIError";
    this.statusCode = opts?.statusCode;
    this.graphqlErrors = opts?.graphqlErrors ?? [];
    this.userErrors = opts?.userErrors ?? [];
  }
}

/**
 * Extract a clean error message from a Jobber GraphQL response.
 * Handles both top-level `errors` array and mutation-level `userErrors`.
 */
export function extractErrors(data: Record<string, unknown>): string | null {
  // Top-level GraphQL errors
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    const messages = data.errors
      .map((e: { message?: string }) => e.message ?? "Unknown error")
      .join("; ");
    return messages;
  }

  return null;
}

/**
 * Check a mutation result for userErrors. Returns the error string or null.
 */
export function extractUserErrors(
  mutationResult: Record<string, unknown>
): string | null {
  const userErrors = mutationResult.userErrors as
    | Array<{ message: string; path?: string[] }>
    | undefined;

  if (!userErrors || userErrors.length === 0) return null;

  return userErrors
    .map((e) => {
      const path = e.path ? ` (${e.path.join(".")})` : "";
      return `${e.message}${path}`;
    })
    .join("; ");
}

/**
 * Format a JobberAPIError for MCP tool response.
 */
export function formatErrorForMCP(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  let message: string;

  if (error instanceof JobberAPIError) {
    message = error.message;
    if (error.userErrors.length > 0) {
      const details = error.userErrors
        .map((e) => `- ${e.message}`)
        .join("\n");
      message += `\n\nDetails:\n${details}`;
    }
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }

  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}
