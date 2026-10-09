# Problem Statement: Generic MCP Server for Gmail and Google Docs

**Project name:** Universal Google Workspace MCP Server  
**Document type:** Problem statement and product requirements  
**Status:** Ready for implementation planning  
**Primary development environments:** Cursor and Google Antigravity  
**Initial integrations:** Gmail (send email) and Google Docs (append to an existing document)  
**Primary implementation recommendation:** TypeScript on Node.js using the official Model Context Protocol TypeScript SDK and Google APIs

---

## 1. Executive Summary

Build a secure, reusable Model Context Protocol (MCP) server that exposes Google Workspace actions as standard MCP tools. Its first version must allow an AI agent to:

1. Send an email through a user-authorized Gmail account.
2. Append text to an existing Google Doc that the authorized account can edit.
3. Inspect the result of an operation and receive clear, machine-readable success or error information.

The server must not be tightly coupled to a single AI model, agent, IDE, or vendor. Its business logic should be independent of Cursor, Antigravity, ChatGPT, Claude, Gemini, and future MCP-capable agents. These clients should interact with the same tool contracts through supported MCP transports.

The solution should support two deployment profiles:

- **Local profile:** Run as a local process using MCP over standard input/output (stdio). This is intended for development and compatible desktop coding agents, including Cursor and Antigravity where their current configuration supports it.
- **Remote profile:** Run as a secured remote MCP endpoint using Streamable HTTP. This is intended for compatible hosted agent products and APIs that can connect to remote MCP servers.

The project must be honest about compatibility: adopting MCP makes the server protocol-oriented and reusable, but it does **not** guarantee that every product, subscription tier, model, or agent runtime can connect to every transport or invoke write-capable tools. Each client must be configured and tested according to its own current requirements.

## 2. Problem Statement

Users increasingly work across several AI environments. A user may plan work in ChatGPT, write code in Cursor or Antigravity, and use Claude or Gemini for research and automation. However, the ability to take actions in personal productivity tools is often tied to a specific agent, provider-specific integration, or custom script.

This creates several problems:

- The same Gmail or Google Docs automation may need to be implemented repeatedly for different agents.
- Provider-specific integrations make it difficult to move an established workflow from one agent to another.
- One-off scripts often lack a consistent tool schema, robust validation, useful errors, and safe handling of credentials.
- Sending an email and editing a document are consequential actions. Unclear authorization, accidental duplicate actions, or weak confirmation rules can produce unwanted side effects.
- Local-only scripts cannot automatically be accessed by hosted agents. Conversely, exposing a local script as a public web service without proper authentication creates unacceptable security risks.
- Google OAuth credentials, access tokens, and refresh tokens are easy to mishandle when development shortcuts become production deployments.

The required solution is a **vendor-neutral MCP server** that implements the Google Workspace operations once and exposes them using stable, documented tool contracts. The server owns Google API integration, OAuth credential handling, validation, security controls, error translation, and operational logs. AI clients are responsible only for discovering and invoking the published MCP tools through a compatible connection.

## 3. Vision and Objectives

### 3.1 Vision

Provide one trustworthy Google Workspace action server that a user can connect to any agent environment that supports the chosen MCP transport and authorization method.

### 3.2 Primary objectives

- Provide a standard MCP interface instead of a provider-specific plugin interface.
- Send email through the Gmail API on behalf of an explicitly authorized Google account.
- Append text to an existing Google Doc without replacing or deleting its existing content.
- Support local development and a secure remote deployment path.
- Use least-privilege Google OAuth scopes and keep secrets out of source control, logs, and tool outputs.
- Validate all inputs before performing external write operations.
- Make side effects, failures, and possible duplicate-operation risks clear to agents and users.
- Keep Google API logic separate from the MCP transport so future transports or clients do not require rewriting the business logic.
- Provide configuration, setup documentation, tests, and acceptance criteria that an implementation agent can follow from Cursor or Antigravity.

### 3.3 Success measures

The MVP is successful when:

- A compatible MCP client can discover the available tools without any provider-specific code inside the server's Google integration layer.
- The server can send a correctly formatted email through the authenticated Gmail account.
- The server can append plain text to an existing, user-authorized Google Doc while preserving the existing content.
- Invalid or unauthorized requests are rejected before a write occurs.
- Credentials are not exposed in logs, responses, repository files, or test output.
- The same core operation modules pass the same tests regardless of whether the server is launched in local stdio mode or remote Streamable HTTP mode.

## 4. Users and Use Cases

### 4.1 Target users

- Individual users who want AI agents to carry out routine email and document actions.
- Developers building workflows in Cursor or Antigravity.
- Users who work across ChatGPT, Claude, Gemini, and other compatible agent environments.
- Future developers who need to add new Google Workspace capabilities without changing existing tool contracts unnecessarily.

### 4.2 Core use cases

**Use case A — Send an email**  
A user asks an agent to send a specified message to one or more recipients. The agent gathers the recipient address(es), subject, and body, invokes the email tool, and reports the operation result. The server validates the request, calls Gmail, and returns a confirmation containing safe identifiers such as the Gmail message ID when available.

**Use case B — Append meeting notes to a Google Doc**  
A user provides an existing Google Docs URL or document ID and asks the agent to add notes. The agent invokes the append tool. The server resolves and validates the document ID, verifies that the authenticated account has access through the Google API call, and inserts new content at the end of the document body. Existing content must not be overwritten.

**Use case C — Reuse a workflow across agent clients**  
A user configures the same MCP server in more than one compatible client. Each client sees the same stable tool names and schemas. The server's Google API logic remains unchanged; only connection configuration may differ.

**Use case D — Diagnose a problem safely**  
A client receives a clear result if authentication has expired, the document is inaccessible, the recipient address is invalid, a Google API quota is exceeded, or the request fails validation. The response should guide the agent toward an appropriate next step without revealing secrets.

## 5. Scope

### 5.1 In scope for the MVP

- MCP server exposing tools with descriptions and structured input schemas.
- Local stdio transport for compatible local clients.
- Remote Streamable HTTP transport as a deployment option.
- Gmail API integration to send plain-text email, with optional HTML body support if implementation and sanitization are safe.
- To, Cc, and Bcc recipient support.
- Google Docs API integration to append plain text to an existing document.
- Accepting a Google Docs URL or raw document ID.
- Optional paragraph separation or leading/trailing newline handling for appended text.
- Google OAuth 2.0 authorization for a designated Google user/account.
- Secure storage and refresh of OAuth credentials appropriate to the chosen deployment profile.
- Environment-based configuration, input validation, consistent error responses, safe logs, tests, and setup documentation.
- A health/diagnostic tool that reports configuration and authorization status without returning access tokens, refresh tokens, secrets, or message contents.
- A documented path for connecting the server to compatible clients.

### 5.2 Explicitly out of scope for the MVP

- Reading, searching, summarizing, or deleting email.
- Managing Gmail labels, filters, drafts, signatures, inbox, or contacts.
- Email attachments, calendar invites, or bulk/marketing email campaigns.
- Creating, deleting, moving, sharing, or changing permissions on Google Docs.
- Replacing document contents, deleting existing text, or arbitrary edits at a supplied position.
- Rich-text formatting, tables, images, comments, suggestions, or Google Docs revision management beyond what is necessary for safe append behavior.
- Google Sheets, Google Slides, Calendar, Drive file search, Microsoft 365, or other services.
- A multi-tenant commercial SaaS service in which many unrelated users sign in and store separate Google credentials.
- A guarantee that all versions and plans of ChatGPT, Claude, Gemini, or any other AI product currently permit custom MCP write actions.
- Browser extensions or a custom end-user frontend.

These may be considered later, but must not delay the initial working version.

## 6. Design Principles

1. **MCP-first, not model-first.** Tool contracts must use MCP conventions and must not depend on one model vendor's function-calling format.
2. **Transport-independent business logic.** Gmail and Docs operations must be callable from ordinary TypeScript modules independently of stdio or HTTP handling.
3. **Least privilege.** Request only the Google OAuth scopes needed by enabled capabilities.
4. **Explicit side effects.** Sending email and modifying a document are write operations. Tool descriptions must say so clearly, and clients should request user confirmation where supported.
5. **No silent broadening of authority.** The server must not infer recipients, invent a target document, or send or append content that was not supplied or clearly approved by the user.
6. **Preserve existing data.** The Docs operation must append; it must not replace document content.
7. **Safe-by-default deployment.** A remote endpoint must not be left unauthenticated on the public internet.
8. **Useful, non-sensitive diagnostics.** Errors should be actionable without leaking tokens, credentials, full email bodies, or private document text.
9. **Stable contracts.** Tool names and JSON input fields should remain predictable; future optional additions should be backward-compatible where possible.
10. **No false universal-compatibility claims.** Document client-specific setup and capability differences clearly.

## 7. Functional Requirements

### FR-1: MCP server initialization and tool discovery

- The server must initialize through a maintained MCP SDK compatible with the target clients' supported protocol versions.
- It must publish its tools through standard MCP tool-discovery mechanisms.
- Each tool must have a clear name, description, input schema, required-field list, and description of write side effects.
- Tool ordering and tool names should be deterministic.
- The server must not require a specific AI model or prompt format.
- The server must return protocol-compliant success and error responses.

### FR-2: Send email with Gmail

The server must expose a tool named `gmail_send_email`.

**Required input fields**

- `to`: one email address or an array of email addresses; normalize internally to a list.
- `subject`: non-empty string, subject to a documented maximum length.
- `body_text`: non-empty plain-text email body.

**Optional input fields**

- `cc`: one or more email addresses.
- `bcc`: one or more email addresses.
- `body_html`: optional HTML alternative, if this feature is implemented for MVP.
- `reply_to`: optional valid reply-to email address.
- `confirm_send`: optional explicit boolean confirmation flag if used as an additional guard. If the implementation uses this flag, its meaning must be documented consistently; it must not be treated as proof of a human approval unless the client actually collected that approval.
- `idempotency_key`: optional caller-supplied unique key to protect against accidental duplicate invocation where the server has a suitable persistent idempotency store.

**Behavior**

- Send using the Gmail API as the account that authorized the server.
- Build a standards-compliant MIME message and encode it correctly for the Gmail API.
- Validate addresses, subject, body, and header values before calling Google.
- Reject CR/LF injection in header fields and reject malformed recipient data.
- Keep the authenticated sender identity controlled by the authorized Google account. Do not let an arbitrary tool argument impersonate a sender.
- Send to all supplied To, Cc, and Bcc recipients with the semantics expected from Gmail.
- Do not send if required fields are missing or invalid.
- Do not automatically retry a send after an ambiguous network timeout if the server cannot establish whether Gmail already accepted the message. Return an explicit uncertain outcome and tell the caller not to blindly repeat the operation.
- On success, return a result with `success`, a safe message, `message_id` when supplied by Gmail, `thread_id` when supplied by Gmail, and a correlation/request ID. Do not return credentials or the full raw MIME payload.
- Do not log the email body or Bcc recipients by default.

**Example input**

```json
{
  "to": ["recipient@example.com"],
  "subject": "Meeting notes",
  "body_text": "Hello,\n\nPlease find the meeting notes below.\n\nRegards"
}
```

**Example success output**

```json
{
  "success": true,
  "operation": "gmail_send_email",
  "message_id": "gmail-message-id",
  "thread_id": "gmail-thread-id",
  "request_id": "request-correlation-id",
  "message": "Gmail accepted the message for sending."
}
```

The IDs above are illustrative, not literal values.

### FR-3: Append text to an existing Google Doc

The server must expose a tool named `google_docs_append_text`.

**Required input fields**

- `document`: a Google Docs URL or a raw Google document ID.
- `text`: the text to append. It must be non-empty after trimming whitespace unless the user explicitly intends to append whitespace.

**Optional input fields**

- `prepend_newline`: boolean controlling whether a paragraph break/newline is inserted before the appended text when appropriate.
- `append_newline`: boolean controlling whether a trailing newline is added after the appended text.
- `idempotency_key`: optional unique key for deduplicating repeated tool invocations if a persistent idempotency store is configured.

**Behavior**

- Parse a valid Google Docs URL or validate a raw document ID.
- Never interpret an arbitrary external URL as a valid Google document.
- Use the Google Docs API to append content to the document body, preferably through the API's end-of-segment insertion location rather than calculating a stale index from an earlier read.
- Preserve all existing content. Do not clear, replace, or reformat the document.
- Make no changes to sharing settings or permissions.
- Let Google API authorization determine whether the authenticated account can edit the document.
- If the document is not found, inaccessible, not editable, deleted, or the URL is invalid, return a specific safe error.
- Return `success`, `document_id`, `document_url`, an optional `document_title` if retrieved safely, a request/correlation ID, and a short result message.
- Avoid returning the entire document text or logging appended content by default.
- If an API timeout occurs after the update may have been applied, do not automatically append the same text again. Return an uncertain outcome and require reconciliation before retrying.
- If the document uses tabs or multiple document segments, document the chosen behavior. For the MVP, append to the main document body / default applicable tab as supported by the API and tested implementation. Do not silently modify a header, footer, or footnote.

**Example input**

```json
{
  "document": "https://docs.google.com/document/d/EXAMPLE_DOCUMENT_ID/edit",
  "text": "Action items:\n- Confirm the delivery date.\n- Share the revised plan."
}
```

**Example success output**

```json
{
  "success": true,
  "operation": "google_docs_append_text",
  "document_id": "EXAMPLE_DOCUMENT_ID",
  "document_url": "https://docs.google.com/document/d/EXAMPLE_DOCUMENT_ID/edit",
  "request_id": "request-correlation-id",
  "message": "Text was appended to the Google Doc."
}
```

The IDs above are illustrative, not literal values.

### FR-4: Check server and Google authorization status

The server should expose a read-only tool named `google_workspace_status` or an equivalent diagnostic command.

It should report:

- Whether the MCP server is running and configured.
- Which capabilities are enabled (Gmail send, Google Docs append).
- Whether credentials are present and can be used for a lightweight authenticated check.
- The authorized Google account identity if it can be obtained safely and is useful to the user.
- A sanitized reason when authorization is missing, expired, revoked, or insufficient.

It must never return access tokens, refresh tokens, client secrets, authorization codes, token-file contents, or other secret values.

### FR-5: Authentication and account authorization

- Google Workspace API access must use Google OAuth 2.0 user consent or another explicitly documented supported Google identity mechanism appropriate to the deployment.
- The default personal-user profile should use OAuth as the actual user whose Gmail account will send the message and whose Docs permissions will be used.
- Request a least-privilege scope set for the enabled functionality. Start with Gmail send permission (`https://www.googleapis.com/auth/gmail.send`) and the scope needed to edit Google Docs (`https://www.googleapis.com/auth/documents`). Do not request full Gmail/mailbox access or broad Drive access unless a clearly justified later feature requires it.
- API enablement, OAuth consent-screen configuration, authorized redirect URIs, testing users, and possible Google verification requirements must be documented.
- Handle expired access tokens through the supported refresh flow. If the refresh token is revoked or no longer valid, provide a clean reauthorization path.
- Separate Google account authorization from authorization to use the MCP server itself. A valid Google token must not automatically make an internet-facing MCP endpoint safe for anyone to call.

### FR-6: Client-independent tool contracts

- Business modules may not contain model-vendor-specific SDK calls.
- Tool names, inputs, outputs, and semantics must be the same across supported deployments.
- Any unavoidable client differences must be documented in setup instructions rather than implemented as different versions of the Google actions.
- Clients that cannot connect directly to a local process must use an appropriate remote deployment or secure tunnel, if supported by the platform.

### FR-7: Error normalization

The server must translate low-level failures into stable, sanitized error categories, for example:

- `VALIDATION_ERROR`
- `AUTH_REQUIRED`
- `AUTH_EXPIRED_OR_REVOKED`
- `INSUFFICIENT_SCOPE`
- `RESOURCE_NOT_FOUND`
- `PERMISSION_DENIED`
- `RATE_LIMITED`
- `GOOGLE_API_ERROR`
- `NETWORK_ERROR`
- `OUTCOME_UNKNOWN`
- `INTERNAL_ERROR`

Errors should contain a human-readable explanation, a category/code, whether the operation was definitely not performed, definitely performed, or may have been performed, and a request ID for diagnostics. They must not include full stack traces, secrets, tokens, raw HTTP authorization headers, or private content.

## 8. Non-Functional Requirements

### NFR-1: Security

- No secrets committed to Git or included in generated documentation/examples.
- Validate all inputs on the server, even when MCP input schemas exist.
- Use HTTPS for remote deployments.
- Authenticate and authorize remote MCP requests. Do not expose a write-capable server anonymously.
- Keep local OAuth token files outside the repository, with restrictive filesystem permissions; prefer an OS credential store when practical.
- Redact credentials and personal content from logs.
- Apply request size limits and reasonable rate limits.
- Use dependencies with active maintenance and pin compatible versions in the lockfile.
- Do not execute arbitrary code, shell commands, or URLs supplied through tool arguments.

### NFR-2: Privacy

- Store only the credentials and operational state required for the server to work.
- Avoid retaining email bodies or document contents.
- Keep logs focused on operation type, timestamps, result category, latency, and correlation ID.
- Make any optional audit store configurable and document its retention policy.

### NFR-3: Reliability

- Use bounded retries only for safe transient operations and rate-limit responses where retry is appropriate.
- Do not blindly retry non-idempotent write operations after an ambiguous timeout.
- Distinguish validation/authentication failures from transient API errors.
- Return structured results consistently.

### NFR-4: Maintainability

- Use TypeScript with strict type checking.
- Keep the code modular and easy to extend.
- Use shared schemas and central error normalization.
- Include unit tests and integration tests, with mocks for Google APIs so most tests do not send real messages or edit real documents.
- Include a clear README and `.env.example` with placeholders only.

### NFR-5: Portability

- Avoid depending on one vendor's proprietary agent SDK.
- Provide a local configuration sample and a remote configuration/deployment guide.
- Use standard environment variables and a documented configuration layer.
- Keep business logic callable independently of the transport.

### NFR-6: Observability

- Emit structured logs with levels and request IDs.
- Include enough information to diagnose failures without recording sensitive content.
- Provide a health check for server readiness and, where feasible, Google API connectivity.
- Avoid reporting a tool as successful until the underlying Google API has confirmed success.

## 9. Cross-Client Compatibility Strategy

“Generic” means the server implements standard MCP capabilities and does not depend on a single AI provider. It does not mean every client supports the same transport, OAuth flow, server configuration, or write permissions.

### 9.1 Required strategy

- Implement tool logic once and share it between transport adapters.
- Support **stdio** for compatible local tools and **Streamable HTTP** for compatible remote clients.
- Use the maintained MCP SDK's supported protocol negotiation rather than hard-coding a protocol version based on an assumption about one client.
- Keep tools within the common MCP tools feature set for the MVP. Do not require optional UI, prompts, sampling, or vendor extensions for core functionality.
- Add a compatibility matrix in the README and update it only after hands-on verification.
- Pin dependencies and run client smoke tests against the versions actually targeted by the project.

### 9.2 Expected client classes

- **Cursor:** local MCP configuration and transport support according to the installed Cursor version.
- **Antigravity:** MCP configuration according to the installed Antigravity version; remote MCP over Streamable HTTP is relevant for hosted/remote workflows where supported.
- **Claude / Claude Desktop:** use the supported local or remote MCP configuration for the product, plan, and version in use. Remote connector availability and transport details may differ by product surface.
- **ChatGPT:** use a supported remote MCP configuration or approved secure tunnel path. Custom MCP write actions are subject to product surface, workspace controls, rollout, and account-plan restrictions. Do not assume a personal ChatGPT account can connect to any arbitrary local server or use write tools.
- **Gemini and other agents:** verify current remote MCP, tool, transport, and authentication requirements for the specific app/API/agent runtime. Gemini product surfaces may differ; a Gemini API integration is not necessarily equivalent to the consumer Gemini app.

### 9.3 Compatibility acceptance rule

The project may claim that it follows the MCP standard and has been tested with named clients. It must not claim universal compatibility until each named client and intended deployment mode has actually been tested. A client that does not support a required transport or write action is a client-side limitation, not a reason to couple Google business logic to that client.

## 10. Deployment Profiles

### 10.1 Profile A — Local developer machine

Purpose: easiest path for Cursor, Antigravity, and other compatible local agents.

Requirements:

- Run the server as a local Node.js process over stdio.
- Read configuration from environment variables or a local ignored configuration file.
- Complete Google OAuth authorization through a documented one-time setup process.
- Store refresh credentials outside the repository with restrictive permissions; do not print them in terminal output.
- Ensure logs go to stderr or an appropriate logger so stdout remains valid for MCP protocol traffic.
- Provide example client configuration, clearly labeled as a template to adjust for each installed client.
- Do not require a public hosting URL for local use.

### 10.2 Profile B — Remote endpoint

Purpose: allow hosted agent products and remote runtimes to connect when they support remote MCP.

Requirements:

- Serve MCP through Streamable HTTP over HTTPS.
- Protect access using a secure authentication and authorization design. The MCP transport's client authentication is separate from Google OAuth credentials held by the server.
- For a single-user self-hosted MVP, a properly scoped access token or trusted secure-tunnel mechanism may be used if it is suitable for the chosen client. For production multi-user use, require a properly designed per-user authorization model; do not share one user's Google refresh token across unrelated users.
- Avoid a publicly reachable anonymous endpoint.
- Configure request limits, rate limits, safe logging, health checks, and secret management.
- Document the host, endpoint path, TLS requirements, authorization header requirements, allowed tool list, and deployment-specific environment variables.
- Verify the actual client can discover tools and execute write operations under the intended product plan and permissions.

### 10.3 Single-user MVP boundary

The first release should be designed for one Google account per server instance. The server may later support multiple independent users, but must not imply multi-tenant safety unless credential isolation, tenant-scoped storage, access control, and data separation have been implemented and tested.

## 11. Recommended Technical Direction

This section guides implementation without forcing unnecessary complexity.

### 11.1 Language and runtime

- TypeScript on a supported Node.js LTS version.
- Official MCP TypeScript SDK (choose and pin a version compatible with the target protocol and client matrix).
- Google's maintained Node.js API client libraries for OAuth and Workspace APIs where appropriate.
- Schema validation library such as Zod, or equivalent strict runtime validation.
- Test framework such as Vitest or Jest.

The implementation agent must confirm current package names, supported SDK APIs, and versions before coding; it must not copy outdated MCP server examples blindly.

### 11.2 Suggested structure

```text
src/
  index.ts                    # Entrypoint and selected transport
  config/
    env.ts                    # Typed configuration validation
  mcp/
    server.ts                 # MCP server registration and tool definitions
    transports/
      stdio.ts                # Local stdio bootstrap
      http.ts                 # Remote Streamable HTTP bootstrap
  auth/
    google-oauth.ts           # OAuth client, refresh, identity/status checks
    token-store.ts            # Secure token persistence abstraction
    mcp-auth.ts               # Remote MCP client authentication/authorization
  services/
    gmail.service.ts          # Gmail API logic
    google-docs.service.ts    # Google Docs API logic
  tools/
    gmail-send-email.ts       # Tool schemas and orchestration
    docs-append-text.ts       # Tool schemas and orchestration
    workspace-status.ts       # Safe diagnostics
  validation/
    email.ts
    document.ts
  errors/
    app-error.ts
    normalize-error.ts
  logging/
    logger.ts
  tests/
    unit/
    integration/
README.md
.env.example
.gitignore
package.json
package-lock.json
problemStatement.md
```

This structure is illustrative. The implementation may simplify it where warranted, but must preserve separation of tool registration, Google API logic, authentication, validation, and transport.

### 11.3 Configuration

Document configuration variables such as the following, adapting names to the chosen implementation:

```dotenv
NODE_ENV=development
MCP_TRANSPORT=stdio
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:PORT/oauth2callback
GOOGLE_TOKEN_STORE_PATH=~/.config/universal-google-workspace-mcp/tokens.json
MCP_AUTH_MODE=none
MCP_ACCESS_TOKEN=
LOG_LEVEL=info
```

Important implementation notes:

- `.env.example` must contain placeholders only. Never place real tokens, secrets, or personal data in it.
- `MCP_AUTH_MODE=none` may be acceptable only for a local stdio process that is not exposed as a network service. It must not enable an anonymous public HTTP server.
- The actual OAuth redirect URI, token-store approach, and remote auth mechanism must be chosen and documented before implementation is considered complete.
- Do not commit the actual `.env`, OAuth client-secret file, or token-store file.

## 12. Security and Safety Requirements for Write Actions

### 12.1 Email sending safeguards

- The tool description must clearly state that invoking the tool sends a real email.
- If the user request is unclear about the recipient, subject, or content, the agent should ask before calling the tool.
- The server validates the destination addresses and required content.
- The server must not allow `from` spoofing via an ordinary user-supplied field.
- Do not silently add additional recipients or include unintended Bcc recipients.
- No default behavior may send a partially filled email.
- The client should request user confirmation for the exact email when it supports a confirmation interface. The server must not claim that a client-side confirmation took place unless it has evidence.
- For production deployment, the operator should be able to restrict allowed recipients/domains or disable sending through configuration, if that can be achieved without making the core tool confusing.

### 12.2 Google Docs safeguards

- The tool description must state that the document will be modified.
- The target document must be explicitly identified by a valid document URL or ID.
- Append-only behavior is mandatory for the MVP.
- Do not attempt to bypass Google's document permissions.
- Do not change sharing settings.
- The client should confirm the target document and appended content where supported and where the request is ambiguous or consequential.

### 12.3 Credentials and secrets

- Keep Google OAuth secrets and refresh tokens server-side; never ask the model to supply them as tool arguments.
- Never return tokens in tool results.
- Never log Authorization headers or full OAuth responses.
- Enforce minimum file permissions for local credential stores.
- Include an operator procedure for revoking the app's Google access and deleting the local token store.
- Remote deployment must use HTTPS, secure secret storage, and access control appropriate to the deployment.

### 12.4 Untrusted tool input

Treat all tool arguments as untrusted. Do not execute supplied strings. For document links, allow only the expected Google Docs URL format or a validated document identifier. For email fields, validate addresses and reject invalid or unsafe headers. Enforce maximum lengths to avoid oversized requests.

## 13. Idempotency, Retries, and Ambiguous Outcomes

Both email sending and document appending are side-effecting operations. An agent may retry a tool after a slow response, disconnection, or unclear result. A blind retry can send a duplicate email or append the same text twice.

Requirements:

- Assign a request/correlation ID to each invocation.
- Support an optional `idempotency_key` for clients that can provide one.
- If idempotency is implemented, persist the key, operation type, safe request fingerprint, and completed outcome in a local store suitable for the deployment. Do not store unnecessary message or document text in that record.
- Reusing the same idempotency key with the same operation should return the recorded result rather than rerun the write.
- Reusing the same key with materially different input should fail with a clear validation error.
- Do not claim exactly-once delivery for email; the underlying API and network cannot guarantee it for every failure mode.
- When the server cannot determine whether a write succeeded, return `OUTCOME_UNKNOWN`, include the request ID, and avoid automatically repeating the operation. Provide safe reconciliation guidance.
- For remote multi-instance deployments, a process-local in-memory cache is not sufficient for idempotency. Use a shared persistent store or disable that claim until one exists.

## 14. Suggested Internal Tool Contracts

The public MCP tool surface should remain small and easy for agents to understand.

| Tool | Type | Purpose | Writes data? |
|---|---|---|---|
| `gmail_send_email` | Action | Send email via the authorized Gmail account | Yes |
| `google_docs_append_text` | Action | Append plain text to an existing Google Doc | Yes |
| `google_workspace_status` | Diagnostic | Verify configuration and authorization status safely | No, except a minimal read-only identity/API check if needed |

Do not expose arbitrary HTTP requests, arbitrary Google API method names, token retrieval, or generic shell execution as tools. Any future capability must have a constrained schema and its own permission/security review.

## 15. Logging and Error Response Format

All responses should be concise and machine-readable, while still useful to a human. The exact MCP SDK result shape can follow the selected SDK, but operation payloads should follow a consistent pattern.

**Success pattern**

```json
{
  "success": true,
  "operation": "operation_name",
  "request_id": "correlation-id",
  "message": "Human-readable result",
  "resource": {}
}
```

**Failure pattern**

```json
{
  "success": false,
  "operation": "operation_name",
  "request_id": "correlation-id",
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "The authorized Google account cannot edit this document.",
    "outcome": "not_performed"
  }
}
```

Allowed `outcome` values should be standardized, for example:

- `not_performed`: the server knows the write did not occur.
- `performed`: the server received confirmation that the write occurred.
- `unknown`: the write may have occurred but the response does not establish the outcome.

Do not return internal stack traces to the agent. Detailed stack traces may be written to a protected diagnostic log only after sensitive values have been redacted.

## 16. Testing Requirements

### 16.1 Unit tests

Cover, at minimum:

- Email address parsing and validation for To/Cc/Bcc.
- Invalid and oversized subject/body fields.
- CR/LF injection attempts in header values.
- Empty recipient list and empty required fields.
- Google Docs URL parsing, raw ID validation, and rejection of unrelated URLs.
- Empty appended text and newline behavior.
- Error normalization for authentication, permission, quota, network, and unexpected failures.
- Secret and private-content redaction in logs.
- Idempotency-key behavior if implemented.

### 16.2 Integration tests with Google APIs

Create opt-in integration tests that require a separately configured test account and explicit environment flag. They must not run in ordinary CI by default.

- Send a test email only to a controlled test recipient.
- Append a uniquely marked test string to a designated test document.
- Verify the Gmail API response and confirm the document content change without modifying unrelated content.
- Validate revoked/expired credentials and insufficient permissions using controlled test cases where feasible.
- Document cleanup or test-data management; never use a user's important personal document for automated tests.

### 16.3 MCP protocol tests

- Verify server initialization and tool discovery.
- Verify each tool exposes the expected schema and clear write-side-effect descriptions.
- Verify valid input reaches the service layer.
- Verify invalid input is rejected before any Google API call.
- Verify transport does not leak logs into stdio protocol output.
- Verify both supported transport profiles use the same tool logic.

### 16.4 Client smoke tests

Maintain a checklist for actual tests in each intended client. A client is marked “verified” only after confirming server connection, tool discovery, Google authorization, a safe test email, and a safe append to a test document as supported by the product. Record client product surface, version/date, transport, and account-plan assumptions.

## 17. Acceptance Criteria / Definition of Done

The MVP is considered complete only when all required criteria below are met.

### Core functionality

- [ ] MCP server starts successfully using the documented local command.
- [ ] A compatible client can list all published tools.
- [ ] `gmail_send_email` sends an email to an authorized test recipient with correct recipients, subject, and body.
- [ ] `google_docs_append_text` appends text to the end of a designated test document.
- [ ] Existing document text is preserved exactly apart from the expected appended text and configured separator.
- [ ] The server returns success only after the corresponding Google API confirms the operation.
- [ ] Google Workspace status is available without exposing any secret or token.

### Validation and failure handling

- [ ] Missing or invalid input is rejected before calling Google APIs.
- [ ] Inaccessible documents and permission errors return understandable sanitized responses.
- [ ] Missing, revoked, expired, and insufficient-scope authorization cases have documented recovery steps.
- [ ] Ambiguous write outcomes are not automatically retried.
- [ ] Error payloads include a correlation ID and a normalized error code.

### Security and quality

- [ ] No real secrets are present in the repository or examples.
- [ ] `.gitignore` excludes environment files, local token stores, generated builds, and logs.
- [ ] Email bodies, document content, Bcc recipients, OAuth tokens, and secrets are not logged by default.
- [ ] Remote HTTP mode is protected and cannot be deployed publicly without authentication configured.
- [ ] TypeScript type checks pass.
- [ ] Unit tests pass.
- [ ] Integration tests are opt-in and use test resources only.
- [ ] Linting and build scripts pass.
- [ ] README explains OAuth setup, APIs to enable, local setup, remote deployment, tool schemas, security considerations, and troubleshooting.
- [ ] Client compatibility statements are based on actual testing and are not presented as universal guarantees.

## 18. Suggested Implementation Phases

These phases are included to help an implementation agent keep work incremental. A separate implementation plan may expand them further.

**Phase 1 — Project foundation**

- Initialize a TypeScript Node.js project with strict checking, linting, tests, and a lockfile.
- Add typed environment configuration and secret-safe logging.
- Add the official MCP SDK and a minimal server with a diagnostic tool.
- Verify tool discovery using a local MCP inspector or a compatible test client.

**Phase 2 — Google OAuth**

- Configure the Google Cloud project, Gmail API, Google Docs API, OAuth consent screen, and authorized redirect URI.
- Implement the documented user authorization flow and refresh-token handling.
- Build a secure token-store abstraction and a safe authorization-status check.
- Verify that credentials never appear in the console, logs, tool output, or repository.

**Phase 3 — Gmail send**

- Implement validation, MIME generation, Gmail API send, structured results, normalized errors, and relevant tests.
- Use a controlled test recipient for the first end-to-end message.

**Phase 4 — Google Docs append**

- Implement Docs URL/ID validation and append-only behavior through the Docs API.
- Test on a designated disposable/test document and verify previous content remains intact.

**Phase 5 — Robustness and security**

- Add request IDs, safe diagnostics, size limits, redaction tests, ambiguous-outcome handling, and idempotency if supported.
- Review OAuth scopes and remote-endpoint protection.

**Phase 6 — Transport profiles**

- Complete and document local stdio mode.
- Implement or finalize Streamable HTTP mode with authentication and secure deployment configuration.
- Confirm that transport adapters call the same service layer and expose identical tool contracts.

**Phase 7 — Client verification and release**

- Test the connection and both write operations with target clients that are available.
- Publish a client compatibility matrix and version/date of testing.
- Complete the README, `.env.example`, test instructions, and deployment guidance.

## 19. Developer-Agent Instructions for Cursor or Antigravity

When an AI coding agent uses this document to implement the project, it should follow these instructions:

1. Read this complete problem statement before creating files or modifying code.
2. Inspect current official MCP SDK documentation and Google API documentation before selecting package versions or copying examples. Prefer maintained SDK APIs and pin dependencies.
3. Start by producing a brief architecture proposal and a file-by-file implementation plan. Keep the scope aligned with the MVP; do not add unrelated integrations.
4. Implement a working vertical slice early: initialize MCP, expose a diagnostic tool, authenticate with Google, send a controlled test email, and append to a test document.
5. Keep business logic independent of any agent vendor and any transport adapter.
6. Use strict types and server-side validation for every tool input.
7. Do not fake successful sends or document updates in production code. Mocks are allowed only in tests and must be clearly separated.
8. Do not hard-code credentials or commit `.env`, OAuth secrets, or tokens. Provide `.env.example` with placeholders and clear setup documentation.
9. Do not expose generic shell execution, arbitrary HTTP calls, or unrestricted Google API access as MCP tools.
10. Do not add email reading or document creation to the MVP unless explicitly requested later.
11. Run type checks, linting, unit tests, build, and applicable protocol tests. Report exactly what passed and what remains unverified.
12. If a platform or client cannot perform a required connection or write operation, document the limitation rather than falsely claiming compatibility.
13. Before the first real email or document modification, use explicitly designated test recipients and test documents.
14. Update the README and this document if implementation decisions materially diverge from the requirements, and explain why.

## 20. Key Decisions and Open Implementation Choices

The following decisions should be confirmed during implementation, with safe defaults used if no additional product requirement is supplied:

- **Default first deployment:** local stdio, single-user instance.
- **Remote deployment:** supported as a separate profile; not required to expose a public endpoint during initial local development.
- **Google identity:** one explicitly authorized Google user per instance for the MVP.
- **Email format:** plain text required; optional HTML body can be added if tested safely.
- **Document format:** append plain text only for MVP; no full Markdown-to-Google-Docs formatting parser.
- **Idempotency store:** choose persistent local storage for local mode if idempotency is implemented; use shared persistence for multi-instance remote deployment. Never represent in-memory deduplication as durable.
- **Confirmation UX:** depend on the connecting client where available, and clearly document write side effects in tool descriptions. A server-side boolean argument is not by itself proof of user approval.
- **Remote MCP authentication:** select based on client support and hosting environment; never assume the Google OAuth credential automatically authenticates MCP callers.
- **Protocol/SDK version:** use a maintained SDK and test against intended client versions rather than manually hard-coding protocol assumptions.

## 21. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Client does not support selected transport | The server cannot connect from that client | Provide stdio and Streamable HTTP profiles; verify clients individually |
| Client product or plan blocks write-capable tools | Email or Docs action unavailable from that surface | State product limitations clearly and test intended account/plan |
| OAuth consent/scope configuration is wrong | Authorization fails or user must reauthorize | Document API enablement, scopes, consent screen, redirect URIs, and troubleshooting |
| Refresh token is leaked | Unauthorized access to a Google account's granted capabilities | Secure storage, no token logging, least privilege, revoke/rotate procedure |
| Remote endpoint has no caller authentication | Unauthorized parties may send email or alter documents | Require remote authentication and HTTPS; fail closed when config is missing |
| Agent supplies malformed or ambiguous data | Wrong recipient or document may be targeted | Runtime validation, explicit inputs, safe tool descriptions, client confirmation where available |
| Network timeout after a write | Duplicate send or duplicate append risk | Do not blindly retry; use request IDs/idempotency where available; return `OUTCOME_UNKNOWN` |
| Google API quotas or transient failures | Operations are delayed or fail | Bounded safe retries, normalized error feedback, quota documentation |
| Scope is broader than needed | Excess access to mail or Drive | Start with least-privilege scopes and review each additional scope |

## 22. Official References

The implementation agent must recheck these sources at implementation time because APIs, MCP versions, product plans, and client support may change.

### Model Context Protocol

- MCP specification and server tools: https://modelcontextprotocol.io/specification/
- MCP tools specification: https://modelcontextprotocol.io/specification/2025-11-25/server/tools (or the current version used by the selected SDK)
- MCP authorization overview: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization (use the current version appropriate to the SDK and client)
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk

### Google APIs and OAuth

- Gmail API `users.messages.send`: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send
- Gmail API guide to creating and sending messages: https://developers.google.com/workspace/gmail/api/guides/sending
- Google Docs API overview/reference: https://developers.google.com/workspace/docs/api/reference/rest
- Google Docs `documents.batchUpdate`: https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate
- Google Docs update requests and `endOfSegmentLocation`: https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request
- OAuth 2.0 for web server applications: https://developers.google.com/identity/protocols/oauth2/web-server

### Client connection and compatibility references

- OpenAI MCP server guidance: https://developers.openai.com/api/docs/guides/tools-connectors-mcp
- ChatGPT developer mode and MCP apps: https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt
- Anthropic MCP overview: https://docs.anthropic.com/en/docs/mcp
- Anthropic remote MCP connector guidance: https://support.anthropic.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers
- Gemini API function calling and remote MCP guidance: https://ai.google.dev/gemini-api/docs/function-calling
- Antigravity agent MCP server configuration: https://ai.google.dev/gemini-api/docs/antigravity-agent

---

## Final Product Definition

Deliver a secure, documented, vendor-neutral MCP server that exposes **Gmail email sending** and **append-only Google Docs updates** through stable standard MCP tools. The same core implementation must be reusable across compatible local and remote agent environments, while respecting each client's actual transport, authorization, product, and write-permission limitations.
