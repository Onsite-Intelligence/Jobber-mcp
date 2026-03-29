/**
 * Jobber GraphQL queries, mutations, and the core request function.
 *
 * All GraphQL operations are defined here as tagged template strings.
 * The jobberRequest() function handles auth, retries, and rate limiting.
 */

import {
  getTokens,
  isTokenExpiringSoon,
  refreshAccessToken,
} from "../auth/oauth.js";
import { JobberAPIError, extractErrors } from "../utils/errors.js";

const API_URL = "https://api.getjobber.com/api/graphql";
const API_VERSION = "2025-04-16";

// Simple rate limiter: track request timestamps
const requestTimestamps: number[] = [];
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  // Purge old timestamps
  while (requestTimestamps.length > 0 && requestTimestamps[0]! < now - RATE_WINDOW_MS) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= RATE_LIMIT) {
    const oldestInWindow = requestTimestamps[0]!;
    const waitMs = oldestInWindow + RATE_WINDOW_MS - now + 100;
    console.error(`[jobber-mcp] Rate limit approaching, waiting ${waitMs}ms`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  requestTimestamps.push(Date.now());
}

/**
 * Execute a GraphQL request against the Jobber API.
 * Handles token refresh, rate limiting, and retries.
 */
export async function jobberRequest(
  query: string,
  variables?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // Refresh token if expiring soon
  if (isTokenExpiringSoon()) {
    await refreshAccessToken();
  }

  await waitForRateLimit();

  const tokens = getTokens();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokens.accessToken}`,
    "Content-Type": "application/json",
    "X-JOBBER-GRAPHQL-VERSION": API_VERSION,
  };

  const body = JSON.stringify({
    query,
    ...(variables ? { variables } : {}),
  });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch(API_URL, { method: "POST", headers, body });

    if (resp.status === 429) {
      const wait = (2 ** attempt) * 2000;
      console.error(
        `[jobber-mcp] Rate limited (429), retrying in ${wait}ms (attempt ${attempt + 1})`
      );
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    if (resp.status === 401 && attempt === 0) {
      console.error("[jobber-mcp] Got 401, attempting token refresh...");
      await refreshAccessToken();
      const newTokens = getTokens();
      headers.Authorization = `Bearer ${newTokens.accessToken}`;
      continue;
    }

    if (!resp.ok) {
      const text = await resp.text();
      throw new JobberAPIError(`Jobber API returned ${resp.status}: ${text}`, {
        statusCode: resp.status,
      });
    }

    const data = (await resp.json()) as Record<string, unknown>;

    const errorMsg = extractErrors(data);
    if (errorMsg) {
      throw new JobberAPIError(errorMsg, {
        graphqlErrors: data.errors as unknown[],
      });
    }

    return (data.data ?? {}) as Record<string, unknown>;
  }

  throw lastError ?? new JobberAPIError("Request failed after 3 retries");
}

// ─── Client Queries ──────────────────────────────────────────────────

export const SEARCH_CLIENTS = `
query SearchClients($searchTerm: String!, $first: Int!, $after: String) {
  clients(searchTerm: $searchTerm, first: $first, after: $after) {
    nodes {
      id
      firstName
      lastName
      name
      isCompany
      companyName
      phones { number description primary }
      emails { address description primary }
      billingAddress { street1 street2 city province postalCode country }
      tags { nodes { label } }
      createdAt
    }
    totalCount
    pageInfo { hasNextPage endCursor }
  }
}`;

export const GET_CLIENT = `
query GetClient($id: EncodedId!) {
  client(id: $id) {
    id
    firstName
    lastName
    name
    isCompany
    companyName
    phones { number description primary }
    emails { address description primary }
    billingAddress { street1 street2 city province postalCode country }
    tags
    createdAt
    clientProperties(first: 10) {
      nodes {
        id
        address { street1 street2 city province postalCode country }
      }
    }
    jobs(first: 10, orderBy: { key: CREATED_AT, direction: DESC }) {
      nodes {
        id
        title
        jobStatus
        createdAt
        total
      }
      totalCount
    }
  }
}`;

export const CREATE_CLIENT = `
mutation CreateClient($input: ClientCreateInput!) {
  clientCreate(input: $input) {
    client {
      id
      firstName
      lastName
      name
      jobberWebUri
    }
    userErrors { message path }
  }
}`;

export const UPDATE_CLIENT = `
mutation UpdateClient($clientId: EncodedId!, $input: ClientUpdateInput!) {
  clientUpdate(clientId: $clientId, input: $input) {
    client {
      id
      firstName
      lastName
      name
      phones { number description primary }
      emails { address description primary }
    }
    userErrors { message path }
  }
}`;

// ─── Request Queries ─────────────────────────────────────────────────

export const CREATE_REQUEST = `
mutation CreateRequest($input: RequestCreateInput!) {
  requestCreate(input: $input) {
    request {
      id
      title
      requestStatus
      jobberWebUri
      createdAt
    }
    userErrors { message path }
  }
}`;

export const LIST_REQUESTS = `
query ListRequests($first: Int!, $after: String) {
  requests(first: $first, after: $after) {
    nodes {
      id
      title
      requestStatus
      createdAt
      client { id name }
      property { address { street1 city province } }
      jobberWebUri
    }
    totalCount
    pageInfo { hasNextPage endCursor }
  }
}`;

export const GET_REQUEST = `
query GetRequest($id: EncodedId!) {
  request(id: $id) {
    id
    title
    requestStatus
    createdAt
    client { id name phones { number } emails { address } }
    property { address { street1 street2 city province postalCode } }
    jobberWebUri
  }
}`;

export const CREATE_REQUEST_NOTE = `
mutation CreateRequestNote($requestId: EncodedId!, $message: String!) {
  requestNoteCreate(requestId: $requestId, message: $message) {
    note { id }
    userErrors { message path }
  }
}`;

// ─── Job Queries ─────────────────────────────────────────────────────

export const LIST_JOBS = `
query ListJobs($first: Int!, $after: String, $filter: JobFilterAttributes) {
  jobs(first: $first, after: $after, filter: $filter) {
    nodes {
      id
      title
      jobNumber
      jobStatus
      startAt
      endAt
      createdAt
      total
      client { id name }
      property { address { street1 city province postalCode } }
      jobberWebUri
    }
    totalCount
    pageInfo { hasNextPage endCursor }
  }
}`;

export const GET_JOB = `
query GetJob($id: EncodedId!) {
  job(id: $id) {
    id
    title
    jobNumber
    jobStatus
    startAt
    endAt
    createdAt
    total
    instructions
    client {
      id
      name
      firstName
      lastName
      phones { number description }
      emails { address description }
    }
    property {
      address { street1 street2 city province postalCode }
    }
    lineItems {
      nodes {
        name
        description
        quantity
        unitPrice
        totalPrice
      }
    }
    visits(first: 20) {
      nodes {
        id
        title
        startAt
        endAt
        status
        assignedUsers { nodes { id name { full } } }
      }
    }
    jobberWebUri
  }
}`;

export const CREATE_JOB = `
mutation CreateJob($input: JobCreateInput!) {
  jobCreate(input: $input) {
    job {
      id
      title
      jobNumber
      jobStatus
      jobberWebUri
    }
    userErrors { message path }
  }
}`;

export const CREATE_JOB_NOTE = `
mutation CreateJobNote($jobId: ID!, $message: String!) {
  jobNoteCreate(jobId: $jobId, message: $message) {
    note { id }
    userErrors { message path }
  }
}`;

// ─── Scheduling / Visit Queries ──────────────────────────────────────

export const GET_SCHEDULE = `
query GetSchedule($startAt: ISO8601Date!, $endAt: ISO8601Date!, $first: Int!, $after: String) {
  jobs(
    filter: {
      startAt: { between: { start: $startAt, end: $endAt } }
      status: [ACTIVE, IN_PROGRESS, TODAY, UPCOMING]
    }
    first: $first
    after: $after
  ) {
    nodes {
      id
      title
      jobStatus
      startAt
      endAt
      client { id name }
      property { address { street1 city province } }
      visits(first: 20) {
        nodes {
          id
          startAt
          endAt
          status
          assignedUsers { nodes { id name { full } } }
        }
      }
      jobberWebUri
    }
    totalCount
    pageInfo { hasNextPage endCursor }
  }
}`;

export const CREATE_VISIT = `
mutation CreateVisit($input: VisitCreateInput!) {
  visitCreate(input: $input) {
    visit {
      id
      startAt
      endAt
    }
    userErrors { message path }
  }
}`;

// ─── Quote Queries ───────────────────────────────────────────────────

export const CREATE_QUOTE = `
mutation CreateQuote($attributes: QuoteCreateAttributes!) {
  quoteCreate(attributes: $attributes) {
    quote {
      id
      quoteNumber
      quoteStatus
      total
      jobberWebUri
    }
    userErrors { message path }
  }
}`;

export const LIST_QUOTES = `
query ListQuotes($first: Int!, $after: String) {
  quotes(first: $first, after: $after) {
    nodes {
      id
      quoteNumber
      quoteStatus
      total
      createdAt
      client { id name }
      jobberWebUri
    }
    totalCount
    pageInfo { hasNextPage endCursor }
  }
}`;

// ─── Invoice Queries ─────────────────────────────────────────────────

export const LIST_INVOICES = `
query ListInvoices($first: Int!, $after: String) {
  invoices(first: $first, after: $after) {
    nodes {
      id
      invoiceNumber
      invoiceStatus
      total
      amountDue
      issuedDate
      dueDate
      createdAt
      client { id name }
      jobberWebUri
    }
    totalCount
    pageInfo { hasNextPage endCursor }
  }
}`;

export const GET_INVOICE = `
query GetInvoice($id: EncodedId!) {
  invoice(id: $id) {
    id
    invoiceNumber
    invoiceStatus
    total
    amountDue
    issuedDate
    dueDate
    createdAt
    subject
    message
    client {
      id
      name
      firstName
      lastName
      phones { number }
      emails { address }
    }
    lineItems {
      nodes {
        name
        description
        quantity
        unitPrice
        totalPrice
      }
    }
    jobberWebUri
  }
}`;

// ─── Account ─────────────────────────────────────────────────────────

export const GET_ACCOUNT = `
query GetAccount {
  account {
    id
    name
    phone
    industry
  }
}`;

// ─── Users (for team member lookups in scheduling) ───────────────────

export const LIST_USERS = `
query ListUsers($first: Int!) {
  users(first: $first) {
    nodes {
      id
      name { first last full }
      email { raw }
      role
    }
  }
}`;
