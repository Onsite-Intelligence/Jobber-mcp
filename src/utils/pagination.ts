/**
 * Cursor-based pagination helper for Jobber's GraphQL API.
 *
 * Jobber uses the `first` / `after` pattern with `pageInfo.hasNextPage`
 * and `pageInfo.endCursor`.
 */

import { jobberRequest } from "../graphql/queries.js";

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface PaginatedResult<T> {
  nodes: T[];
  totalCount: number | null;
  pageInfo: PageInfo;
}

/**
 * Fetch a single page from a paginated Jobber query.
 *
 * @param query - The GraphQL query string (must include $first and $after variables)
 * @param variables - Query variables (first, after, plus any filters)
 * @param rootField - The top-level field in the response (e.g. "clients", "jobs")
 * @returns Parsed page with nodes, totalCount, and pageInfo
 */
export async function fetchPage<T>(
  query: string,
  variables: Record<string, unknown>,
  rootField: string
): Promise<PaginatedResult<T>> {
  const data = await jobberRequest(query, variables);
  const root = data[rootField] as {
    nodes?: T[];
    totalCount?: number;
    pageInfo?: PageInfo;
  } | undefined;

  if (!root) {
    return {
      nodes: [],
      totalCount: null,
      pageInfo: { hasNextPage: false, endCursor: null },
    };
  }

  return {
    nodes: root.nodes ?? [],
    totalCount: root.totalCount ?? null,
    pageInfo: root.pageInfo ?? { hasNextPage: false, endCursor: null },
  };
}

/**
 * Fetch all pages from a paginated query (up to maxPages to prevent runaway).
 */
export async function fetchAllPages<T>(
  query: string,
  variables: Record<string, unknown>,
  rootField: string,
  maxPages = 10
): Promise<T[]> {
  const allNodes: T[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (page < maxPages) {
    const result: PaginatedResult<T> = await fetchPage<T>(
      query,
      { ...variables, after: cursor },
      rootField
    );
    allNodes.push(...result.nodes);

    if (!result.pageInfo.hasNextPage || !result.pageInfo.endCursor) break;
    cursor = result.pageInfo.endCursor;
    page++;
  }

  return allNodes;
}
