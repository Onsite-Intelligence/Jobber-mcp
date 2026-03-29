# jobber-mcp-server

[![npm version](https://img.shields.io/npm/v/jobber-mcp-server)](https://www.npmjs.com/package/jobber-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-18%2B-brightgreen)](https://nodejs.org)

MCP server for the [Jobber](https://getjobber.com) field service management API — client management, job scheduling, quoting, invoicing, and service request intake. Built for AI agents working in home services.

## What is this?

This is a "driver" that lets any MCP-compatible AI assistant (Claude, etc.) read and write data in a Jobber account. [MCP (Model Context Protocol)](https://modelcontextprotocol.io) is an open standard that gives AI models a structured way to call external tools — think of it like a USB port between an AI and your business software.

With this server running, an AI agent can search for clients, create jobs, check the schedule, send quotes, and more — all through natural conversation.

## Quick Install

**Claude Code (recommended):**

```bash
claude mcp add jobber --scope user \
  -e JOBBER_CLIENT_ID=your_id \
  -e JOBBER_CLIENT_SECRET=your_secret \
  -e JOBBER_ACCESS_TOKEN=your_token \
  -e JOBBER_REFRESH_TOKEN=your_refresh \
  -- npx -y jobber-mcp-server
```

**Claude Desktop:**

Add to your `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "jobber": {
      "command": "npx",
      "args": ["-y", "jobber-mcp-server"],
      "env": {
        "JOBBER_CLIENT_ID": "your_client_id",
        "JOBBER_CLIENT_SECRET": "your_client_secret",
        "JOBBER_ACCESS_TOKEN": "your_access_token",
        "JOBBER_REFRESH_TOKEN": "your_refresh_token"
      }
    }
  }
}
```

## Example Conversations

Once connected, just talk to Claude naturally:

- **"Search for client John Smith"** — calls `jobber_search_clients` to find matching clients by name
- **"What jobs are scheduled for tomorrow?"** — calls `jobber_get_schedule` to pull tomorrow's visits and assignments
- **"Create a quote for Sarah at 123 Main St — furnace inspection, $150"** — calls `jobber_create_client` + `jobber_create_quote` to set up the client and draft the estimate
- **"Show me all unpaid invoices"** — calls `jobber_list_invoices` filtered to outstanding balances

## Available Tools

### Clients
| Tool | Description |
|------|-------------|
| `jobber_search_clients` | Search clients by name, email, or phone |
| `jobber_get_client` | Get full client details, properties, and recent jobs |
| `jobber_create_client` | Create a new client |
| `jobber_update_client` | Update an existing client's info |

### Requests
| Tool | Description |
|------|-------------|
| `jobber_create_request` | Create a new service request with optional notes |
| `jobber_list_requests` | List service requests with pagination |
| `jobber_get_request` | Get full details for a service request |

### Jobs
| Tool | Description |
|------|-------------|
| `jobber_list_jobs` | List jobs with status/date filters |
| `jobber_get_job` | Get job details including line items and visits |
| `jobber_create_job` | Create a new job with line items |
| `jobber_update_job_status` | Add a note to a job |

### Scheduling
| Tool | Description |
|------|-------------|
| `jobber_get_schedule` | Get schedule for a date range |
| `jobber_create_visit` | Schedule a visit for an existing job |
| `jobber_get_availability` | Check available time slots for team members |

### Quotes
| Tool | Description |
|------|-------------|
| `jobber_create_quote` | Create a draft quote with line items |
| `jobber_list_quotes` | List quotes with pagination |

### Invoices
| Tool | Description |
|------|-------------|
| `jobber_list_invoices` | List invoices with status and amounts |
| `jobber_get_invoice` | Get full invoice details with line items |

## Getting Jobber API Credentials

1. Create a developer account at [developer.getjobber.com](https://developer.getjobber.com/)
2. Create a new app — select the scopes your use case needs (clients, jobs, quotes, invoices, scheduling)
3. Note your **Client ID** and **Client Secret** from the app settings
4. Complete the OAuth2 authorization flow to get your tokens:
   - Redirect a Jobber account owner to `https://api.getjobber.com/api/oauth/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=YOUR_REDIRECT&response_type=code`
   - After they authorize, Jobber redirects back with a `?code=` parameter
   - Exchange the code for tokens: `POST https://api.getjobber.com/api/oauth/token` with `grant_type=authorization_code`, your client ID/secret, and the code
   - The response contains your `access_token` and `refresh_token`

> **Note:** The `scripts/extract-tokens.py` script is for pulling tokens from an existing FirstVisitAI database — it does not handle the OAuth flow itself.

## Install from Source

### Prerequisites

- Node.js 18+
- A [Jobber developer app](https://developer.getjobber.com/)
- OAuth2 credentials (client ID, client secret, access token, refresh token)

### Clone and build

```bash
git clone https://github.com/Onsite-Intelligence/Jobber-mcp.git
cd Jobber-mcp
npm install
npm run build
```

### Configure

Copy the example environment file and fill in your Jobber credentials:

```bash
cp .env.example .env
```

Your `.env` should look like this:

```env
JOBBER_CLIENT_ID=your_client_id
JOBBER_CLIENT_SECRET=your_client_secret
JOBBER_ACCESS_TOKEN=your_access_token
JOBBER_REFRESH_TOKEN=your_refresh_token
```

### Connect to Claude Code (from source)

```json
{
  "mcpServers": {
    "jobber": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/path/to/Jobber-mcp",
      "env": {
        "JOBBER_CLIENT_ID": "your_client_id",
        "JOBBER_CLIENT_SECRET": "your_client_secret",
        "JOBBER_ACCESS_TOKEN": "your_access_token",
        "JOBBER_REFRESH_TOKEN": "your_refresh_token"
      }
    }
  }
}
```

### Connect via HTTP (for remote/hosted use)

Start the server in HTTP mode:

```bash
TRANSPORT=http HTTP_PORT=3000 jobber-mcp
```

The MCP endpoint will be available at `http://localhost:3000/mcp`.

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JOBBER_CLIENT_ID` | Yes | — | OAuth2 client ID from your Jobber developer app |
| `JOBBER_CLIENT_SECRET` | Yes | — | OAuth2 client secret |
| `JOBBER_ACCESS_TOKEN` | Yes | — | OAuth2 access token (obtained after authorization) |
| `JOBBER_REFRESH_TOKEN` | Yes | — | OAuth2 refresh token |
| `TRANSPORT` | No | `stdio` | Transport mode: `stdio` or `http` |
| `HTTP_PORT` | No | `3000` | Port for HTTP transport |
| `HTTP_HOST` | No | `localhost` | Host for HTTP transport |

## Token Management

Jobber access tokens expire after ~1 hour. This server handles token refresh automatically:

1. Before each API call, the server checks if the token is expiring within 5 minutes
2. On a 401 response, the server refreshes the token and retries
3. After a successful refresh, the new tokens are **written back to your `.env` file** automatically
4. Tokens are also logged to stderr as a fallback

If the `.env` file doesn't exist or isn't writable, the server falls back to stderr-only logging with a warning.

The `scripts/extract-tokens.py` utility can pull tokens from an existing Jobber integration if you need to bootstrap credentials.

## Rate Limiting

Jobber's API allows 60 requests per minute. The server tracks request timestamps and automatically delays when approaching the limit. If a 429 response is received, it retries with exponential backoff (up to 3 attempts).

## License

MIT
