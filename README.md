# Universal Google Workspace MCP Server

[![CI](https://github.com/imnashraf/MCP-Server/actions/workflows/ci.yml/badge.svg)](https://github.com/imnashraf/MCP-Server/actions/workflows/ci.yml)

A vendor-neutral [Model Context Protocol](https://modelcontextprotocol.io) server exposing three tools:

| Tool | Writes? | Purpose |
|---|---|---|
| `gmail_send_email` | **Yes – sends real email** | Send plain-text (optionally HTML) email as the authorized Gmail account |
| `google_docs_append_text` | **Yes – modifies a doc** | Append text to the end of an existing Google Doc (never replaces content) |
| `google_workspace_status` | No | Safe diagnostics: capabilities and authorization state, no secrets |

Single Google account per server instance. Pushes to `main` run CI on GitHub; Railway deploys only after CI passes. Business logic (`src/services`, `src/validation`) is independent of the transport (`src/mcp/transports`) and of any AI vendor.

## Setup

Requires Node ≥ 22.12.

```bash
npm install
cp .env.example .env      # fill GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
npm run build
```

### Google Cloud
1. Create a project; enable the **Gmail API** and **Google Docs API**.
2. Configure the **OAuth consent screen** (External is fine for personal use). While in *Testing* status, add your account under *Test users*; refresh tokens for testing apps expire after 7 days — publish the app or re-run `npm run auth` when that happens.
3. Create an **OAuth client ID** of type *Desktop app* (or *Web* with redirect URI `http://127.0.0.1:53682/oauth2callback`).
4. Put the client ID/secret in `.env`.

### Authorize (one time)
```bash
npm run auth          # prints a URL; approve in the browser
npm run auth -- --revoke   # revokes at Google and deletes the local token file
```
Scopes requested (least privilege): `gmail.send`, `documents`, plus `openid email` to display which account is authorized. Tokens are stored at `GOOGLE_TOKEN_STORE_PATH` (default `~/.config/universal-google-workspace-mcp/tokens.json`, mode 0600, must be outside the repo). `gmail.send` cannot read mail and `documents` is limited to Docs.

Verify: `npm run inspector` and call `google_workspace_status`.

## Local profile (stdio)

Template — adjust to your client's current config format (Cursor: `.cursor/mcp.json` or `~/.cursor/mcp.json`; Claude Desktop: `claude_desktop_config.json`; Antigravity: its MCP config):

```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "node",
      "args": ["/absolute/path/to/MCP Server/dist/index.js"],
      "env": { "MCP_ENV_FILE": "/absolute/path/to/MCP Server/.env" }
    }
  }
}
```
Logs go to stderr only; stdout carries protocol traffic.

## Remote profile (Streamable HTTP)

```bash
MCP_TRANSPORT=http npm start     # or: npm run start:http
```
Fail-closed rules enforced at startup:
- `MCP_ACCESS_TOKEN` (≥ 32 random chars) is mandatory; every request to the MCP path needs `Authorization: Bearer <token>`. Anonymous HTTP is refused.
- Binding a non-loopback interface requires TLS (`MCP_HTTP_TLS_CERT_PATH`/`KEY_PATH`) **or** `MCP_HTTP_BEHIND_TLS_PROXY=true` behind an HTTPS reverse proxy.
- Set `MCP_HTTP_ALLOWED_HOSTS` to your public hostname (DNS-rebinding protection); browser `Origin`s are rejected unless listed.
- Body size limit and per-IP rate limit are configurable. `GET /healthz` is an unauthenticated liveness probe.

Endpoint: `https://<host>/mcp`, stateless JSON responses. The bearer token authenticates MCP callers and is entirely separate from the Google credentials held by the server. This is a **single-user** design: do not share one Google refresh token across unrelated users. Bearer-token auth is a self-hosted MVP mechanism; clients that only support OAuth-based remote connectors (e.g. some hosted products) would need an OAuth front-end, which is not implemented.

Run one instance only if you rely on idempotency keys (the store is a local file).

### Railway
See [deployment-plan.md](deployment-plan.md). The code supports it as follows:
- `railway.json` sets build/start commands, the `/healthz` healthcheck and a single replica.
- Port: `MCP_HTTP_PORT`, else Railway's `PORT`, else 3000.
- Allowed hosts default to Railway's `RAILWAY_PUBLIC_DOMAIN`; a public bind with no allowed host is refused.
- If a volume is attached (`RAILWAY_VOLUME_MOUNT_PATH`), token and idempotency files default to it.
- `GOOGLE_REFRESH_TOKEN` (with optional `GOOGLE_TOKEN_SCOPE`, `GOOGLE_AUTHORIZED_EMAIL`) seeds an empty token store, because consent cannot run on the host. Authorize locally with `npm run auth`, then copy only the `refresh_token`. An existing stored token is never overwritten, so to switch to a new seed delete `tokens.json` on the volume and redeploy.

## Tool contracts

Every result is JSON (also in `structuredContent`); failures set `isError`.

```json
{ "success": true, "operation": "gmail_send_email", "request_id": "…", "message": "…", "message_id": "…", "thread_id": "…" }
{ "success": false, "operation": "…", "request_id": "…", "error": { "code": "PERMISSION_DENIED", "message": "…", "outcome": "not_performed", "hint": "…" } }
```

`outcome`: `not_performed` | `performed` | `unknown`. Codes: `VALIDATION_ERROR`, `AUTH_REQUIRED`, `AUTH_EXPIRED_OR_REVOKED`, `INSUFFICIENT_SCOPE`, `RESOURCE_NOT_FOUND`, `PERMISSION_DENIED`, `RATE_LIMITED`, `GOOGLE_API_ERROR`, `NETWORK_ERROR`, `OUTCOME_UNKNOWN`, `INTERNAL_ERROR`.

**`gmail_send_email`** — required: `to` (string | string[]), `subject` (≤ 998 chars), `body_text`. Optional: `cc`, `bcc`, `body_html` (only if `GMAIL_ENABLE_HTML_BODY=true`), `reply_to`, `confirm_send`, `idempotency_key`. The sender is always the authorized account; there is no `from` field. Addresses must be plain `local@domain` (no display names); CR/LF and control characters are rejected.

**`google_docs_append_text`** — required: `document` (docs.google.com URL or raw ID), `text` (≤ 100 000 chars). Optional: `prepend_newline` (default true), `append_newline` (default true), `idempotency_key`. Uses `insertText` with `endOfSegmentLocation` on the main body of the default tab; headers, footers and footnotes are never touched. A pre-flight title read confirms access before writing. Only `docs.google.com/document/d/<id>` URLs are accepted.

## Safety behavior

- **No automatic retry of writes.** Timeouts/connection resets/5xx on a send or append yield `OUTCOME_UNKNOWN` (`outcome: "unknown"`). Check the Sent folder / document before retrying.
- **Idempotency** (`idempotency_key`, 8–128 chars): file-backed, single node. Same key + same input → recorded result returned, no second write. Same key + different input → `VALIDATION_ERROR`. A key whose earlier attempt ended unknown is blocked (`OUTCOME_UNKNOWN`) until you use a new key. Only hashes and ids are stored, never content. This is not exactly-once delivery.
- `GMAIL_ALLOWED_RECIPIENTS` / `GMAIL_ALLOWED_RECIPIENT_DOMAINS` restrict recipients (checked across To/Cc/Bcc); `GMAIL_REQUIRE_CONFIRM_SEND` demands `confirm_send=true`. That flag is a guard, **not** proof a human approved — rely on your client's tool-approval prompt for that. Set `ENABLE_GMAIL_SEND=false` / `ENABLE_DOCS_APPEND=false` to remove a tool.
- Logs record operation, request id, result code and latency only. Tokens, secrets, bodies, subjects, Bcc lists and document text are redacted.

## Development

```bash
npm run check             # typecheck + lint + tests + build
npm test                  # unit + protocol tests (Google fully mocked)
npm run test:integration  # opt-in live tests; needs TEST_EMAIL_RECIPIENT and TEST_DOCUMENT_ID
```
Never point live tests at real recipients or important documents.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `AUTH_REQUIRED` | Run `npm run auth` |
| `AUTH_EXPIRED_OR_REVOKED` | Re-run `npm run auth` (also happens after 7 days for apps in *Testing*, or after revoking access) |
| `INSUFFICIENT_SCOPE` | Re-run `npm run auth` and accept all permissions |
| `GOOGLE_API_ERROR` “API not enabled” | Enable Gmail API / Docs API in the Cloud project |
| `RESOURCE_NOT_FOUND` / `PERMISSION_DENIED` on a doc | Wrong ID, or the authorized account can't edit it |
| Server exits at startup with a config message | Messages name the variable and rule; values are never printed |
| Client can't connect | Check the client supports the transport (stdio vs Streamable HTTP) and bearer headers |

## Client compatibility

**No client has been verified yet.** The server is covered by automated tests using the official MCP SDK client over in-memory and Streamable HTTP transports, and a manual stdio smoke test (clean JSON on stdout, tool discovery). Record real results below only after a hands-on test (connection, tool discovery, authorization, test email, test append).

| Client | Version / date | Transport | Result |
|---|---|---|---|
| Cursor | — | stdio | not tested |
| Antigravity | — | stdio / HTTP | not tested |
| Claude Desktop | — | stdio | not tested |
| ChatGPT | — | HTTP | not tested (custom MCP write support depends on plan/workspace) |
| Gemini | — | HTTP | not tested |

## Revoking access
`npm run auth -- --revoke`, or remove the app at <https://myaccount.google.com/permissions> and delete the token file.
