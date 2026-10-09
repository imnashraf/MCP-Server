# Deployment Plan: Universal Google Workspace MCP Server on Railway

**Status:** Phase 0 code changes implemented (see 2); deployment itself not yet executed · **Profile:** Remote (Streamable HTTP), single user, single replica · **Written:** 2026-10-10

Railway specifics below (builder name, volume behavior, CLI commands) are from general knowledge and should be re-checked against current Railway docs when executing.

---

## 1. Goal and constraints

Run the server as a Railway web service reachable at `https://<name>.up.railway.app/mcp`, protected by a bearer token, using the Google account already authorized locally (`mna.nabil@gmail.com`).

Constraints that shape the plan:

| Constraint | Consequence |
|---|---|
| Railway's container filesystem is ephemeral | Tokens and the idempotency store must live on a **Railway Volume**. |
| Volumes attach to one replica | Run exactly **1 replica**. This also matches the file-based idempotency store, which is not valid across instances. |
| `npm run auth` uses a loopback redirect (`127.0.0.1:53682`) | Consent **cannot** be done on Railway. Authorize locally, then transfer the credential. |
| Railway injects `PORT` and terminates TLS at its edge | The app must listen on `$PORT` on `0.0.0.0` and declare `MCP_HTTP_BEHIND_TLS_PROXY=true`. |
| Config refuses unsafe setups | `MCP_ACCESS_TOKEN` (≥ 32 chars) is mandatory; non-loopback plain HTTP is refused unless the TLS-proxy flag is set. |
| Google OAuth app in *Testing* status | Refresh tokens **expire after 7 days**. Must be addressed before relying on the deployment (see 4.2). |

## 2. Gaps in the current code (Phase 0: implemented)

> Implemented: `PORT` fallback, `GOOGLE_REFRESH_TOKEN` seeding, `railway.json`, tests. Also added beyond the original list: allowed hosts default to `RAILWAY_PUBLIC_DOMAIN` and are now mandatory on a public bind; token/idempotency files default to `RAILWAY_VOLUME_MOUNT_PATH`. Optional `GOOGLE_TOKEN_SCOPE` and `GOOGLE_AUTHORIZED_EMAIL` accompany the seed.

The server works locally but two small changes are needed for Railway.

1. **Honor Railway's `PORT`.** `MCP_HTTP_PORT` is the only port variable today. Make config use `MCP_HTTP_PORT ?? PORT ?? 3000`. (Workaround without code: set `MCP_HTTP_PORT` to a fixed value and set Railway's `PORT` variable to the same value; less robust.)
2. **Seed the token store from an environment variable.** Add optional `GOOGLE_REFRESH_TOKEN`: on startup, if the token store file is missing and the variable is set, write `{refresh_token, scope, email}` to the store (mode 0600). The server then refreshes access tokens itself and persists them to the volume. This avoids shelling into the container to place a file and makes redeploys/rebuilds self-healing. Treat the variable as a secret and remove it from Railway once the volume holds the token if you prefer a smaller secret footprint.
   - Alternative with no code change: after first deploy, copy `tokens.json` onto the volume via `railway ssh`. Workable but manual and easy to get wrong (permissions, path).
3. Add tests for both (config precedence; seeding writes 0600 file only when the store is empty and never overwrites an existing store).
4. Add `railway.json` (section 3.3) and re-run `npm run check`.

Estimated effort: under an hour including tests.

## 3. Target configuration

### 3.1 Service
- **Source:** GitHub repo connected to Railway (needs the project pushed to a repo; currently the working tree has no commits). Alternatively deploy with `railway up` from the local directory.
- **Build:** `npm ci && npm run build` (compiles with `tsc`, which is a devDependency, so do not set `NODE_ENV=production` *before* the install step; Railway's default build behavior normally handles this, verify).
- **Start:** `node dist/index.js`
- **Node:** `engines.node >= 22.12` in `package.json` is respected by Railway's builder; confirm the build log shows Node ≥ 22.12.
- **Replicas:** 1. **Region:** nearest to you.
- **Healthcheck path:** `/healthz` (unauthenticated, returns `{"status":"ok"}` only).

### 3.2 Volume
- Create a volume, mount path **`/data`** (about 1 GB is plenty).
- Resulting files: `/data/tokens.json`, `/data/idempotency.json`.
- `/data` is outside the app directory (`/app`), satisfying the rule that the token store must not sit inside the project.

### 3.3 `railway.json`
```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "buildCommand": "npm ci && npm run build" },
  "deploy": {
    "startCommand": "node dist/index.js",
    "healthcheckPath": "/healthz",
    "healthcheckTimeout": 60,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5,
    "numReplicas": 1
  }
}
```

### 3.4 Environment variables

Set in Railway → Service → Variables. Mark secrets as sealed/secret where available.

| Variable | Value | Notes |
|---|---|---|
| `MCP_TRANSPORT` | `http` | |
| `MCP_HTTP_HOST` | `0.0.0.0` | Required to accept Railway's proxy traffic. |
| `MCP_HTTP_BEHIND_TLS_PROXY` | `true` | Railway terminates HTTPS. |
| `MCP_HTTP_TRUST_PROXY` | `true` | So rate limiting keys on the real client IP. Verify the hop count (config trusts exactly 1 proxy). |
| `MCP_HTTP_ALLOWED_HOSTS` | `<your-domain>.up.railway.app` (plus any custom domain) | DNS-rebinding protection. **Required**: with a non-loopback bind and no list, host checking is permissive. |
| `MCP_ACCESS_TOKEN` | 32+ random chars | `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Secret. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From the Desktop-app client JSON | Secrets. |
| `GOOGLE_TOKEN_STORE_PATH` | `/data/tokens.json` | |
| `IDEMPOTENCY_STORE_PATH` | `/data/idempotency.json` | |
| `GOOGLE_REFRESH_TOKEN` | From local `tokens.json` | Only after Phase 0 item 2. Secret. |
| `LOG_LEVEL` | `info` | Logs go to stderr and are redacted. |
| `GMAIL_ALLOWED_RECIPIENTS` / `GMAIL_ALLOWED_RECIPIENT_DOMAINS` | Recommended | A hosted, internet-reachable write endpoint should have a recipient allow-list. |
| `GMAIL_REQUIRE_CONFIRM_SEND` | Optional `true` | A guard, not proof of human approval. |
| `MCP_AUTH_MODE` | **leave unset** | Defaults to `bearer` for HTTP; `none` is refused. |
| `MCP_HTTP_ALLOWED_ORIGINS` | leave empty | Rejects browser origins; non-browser MCP clients send no `Origin`. |

Do **not** set `MCP_ENV_FILE`; there is no `.env` on Railway and `.env` is git-ignored.

## 4. Google-side preparation

### 4.1 Obtain the refresh token locally
`npm run auth` has already been run; the token is at `~/.config/universal-google-workspace-mcp/tokens.json`. Copy only the `refresh_token` value (and `scope`, `email`) into Railway. Do not paste it into chat, tickets or commits.

### 4.2 Avoid the 7-day expiry (do this first)
In Google Cloud Console → OAuth consent screen, the app is in *Testing*, so the refresh token dies after 7 days and the deployment would silently turn into `AUTH_EXPIRED_OR_REVOKED`.
- Move the consent screen to **In production**. Because `gmail.send` and `documents` are sensitive scopes, the app stays *unverified* (users see a warning, capped at 100 users), which is fine for a single-user deployment and does not apply the 7-day limit.
- **After switching, re-run `npm run auth` locally** to mint a fresh refresh token, then use that token for Railway. Tokens issued while in Testing keep the 7-day limit.

### 4.3 Redirect URI
No change needed. Railway never performs the consent flow, so no Railway URL has to be added to the OAuth client.

## 5. Rollout steps

1. **Phase 0** code changes (section 2); `npm run check` green; commit and push.
2. Google: switch to production, re-run `npm run auth`, keep `tokens.json` safe.
3. Railway: new project → deploy from the GitHub repo. Add `railway.json`.
4. Attach the volume at `/data`.
5. Set variables (3.4). Generate a **public domain** for the service; put that hostname in `MCP_HTTP_ALLOWED_HOSTS` and redeploy.
6. Deploy; watch the log for `MCP server listening on Streamable HTTP`.
7. **Verify (section 6).**
8. Connect a client (section 7).

## 6. Verification checklist

Run from your machine against `https://<domain>`:

| # | Check | Expected |
|---|---|---|
| 1 | `GET /healthz` | `200 {"status":"ok"}` |
| 2 | `POST /mcp` without a token | `401` |
| 3 | `POST /mcp` with a wrong token | `401` |
| 4 | Request with a forged `Host:` header | `403` |
| 5 | `tools/list` with the bearer token | `gmail_send_email, google_docs_append_text, google_workspace_status` |
| 6 | `google_workspace_status` | `google_authorization.state: ok`, account shown, no tokens in output |
| 7 | `gmail_send_email` to your own address with an `idempotency_key`, then repeat with the same key | First sends; second returns `replayed: true` and sends nothing |
| 8 | `google_docs_append_text` against a throwaway doc | Marked line appended, existing content intact |
| 9 | Redeploy, then repeat check 6 and the replay in check 7 | Still authorized (volume persisted); replay still recognized |
| 10 | Review Railway logs | No tokens, bodies, subjects or Bcc addresses |

Reuse `/tmp/ugw-http-test.sh`-style curl checks with the public URL (use `bash`, not zsh, for header arrays).

## 7. Connecting clients

- **Clients that allow a custom `Authorization` header** (e.g. Cursor/Claude Code style `url` + `headers` config, MCP Inspector): works as designed.
  ```json
  { "mcpServers": { "google-workspace": {
      "url": "https://<domain>/mcp",
      "headers": { "Authorization": "Bearer <MCP_ACCESS_TOKEN>" } } } }
  ```
- **Hosted products that only support OAuth-based remote connectors** (some ChatGPT/Claude/Gemini surfaces): a static bearer token will not work. Supporting them requires an OAuth authorization layer in front of the server, which is out of scope for this MVP. Record this in the README compatibility table after testing.
- Only mark a client "verified" in the README after a real connection, discovery, test email and test append.

## 8. Security notes for the hosted endpoint

- The endpoint can send email as you. Anyone with `MCP_ACCESS_TOKEN` can use it: share it with nobody, store it only in Railway and the client config, and rotate it by changing the variable and redeploying.
- Keep the recipient allow-list on. Consider `ENABLE_DOCS_APPEND=false` or `ENABLE_GMAIL_SEND=false` if you only need one tool.
- Rate limit is per-IP (default 60/min) and body size 1 MB; tune via `MCP_HTTP_RATE_LIMIT_PER_MINUTE` / `MCP_HTTP_MAX_BODY_BYTES`.
- Railway project access equals access to the secrets. Limit project members.
- Google client secret and refresh token live only in Railway variables and the volume; never in the repo (`.gitignore` already excludes `.env`, token files and client-secret JSON). The client-secret JSON in `~/Downloads` should be deleted or moved to a password manager.

## 9. Operations

- **Logs:** Railway log viewer (JSON lines with `request_id`, `operation`, result, latency).
- **Token revoked or expired:** status shows `expired_or_revoked`. Re-run `npm run auth` locally, update `GOOGLE_REFRESH_TOKEN`, delete `/data/tokens.json` (so it reseeds), redeploy.
- **Rotate bearer token:** change `MCP_ACCESS_TOKEN`, redeploy, update clients.
- **Rollback:** Railway → Deployments → redeploy a previous successful build. Volume data is unaffected.
- **Decommission:** `npm run auth -- --revoke` locally (revokes at Google), delete the Railway service and volume, remove the app at https://myaccount.google.com/permissions.
- **Scaling:** do not raise replicas above 1 while using the file-based idempotency store and a volume.
- **Cost:** a small always-on service plus a small volume; check current Railway pricing and whether your plan allows volumes.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Refresh token expires after 7 days (Testing mode) | Publish consent screen to production, re-authorize (4.2) |
| Duplicate send or append after a timeout | Existing no-auto-retry behavior; use `idempotency_key`; `OUTCOME_UNKNOWN` means verify before retrying |
| Idempotency/token files lost if volume is missing or misconfigured | Verify check 9; the refresh-token seed variable re-creates the token store |
| Forgotten `MCP_HTTP_ALLOWED_HOSTS` | Verify check 4 |
| Client can't use a static bearer token | Documented limitation; OAuth front-end is future work |
| Wrong proxy hop count breaks rate-limit IP detection | Verify with two requests from different networks, or adjust `trust proxy` in code |
| Leaked `MCP_ACCESS_TOKEN` | Rotate immediately; allow-list limits blast radius |

## 11. Definition of done

- Phase 0 merged; `npm run check` passes.
- Service is up on a Railway domain; healthcheck green; one replica; volume mounted at `/data`.
- Verification checks 1–10 pass.
- Consent screen is in production and a fresh token is in use.
- README updated with the Railway section and the actual client compatibility results.
