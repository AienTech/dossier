# HireMe MCP

HireMe exposes a model-independent MCP server at `/api/mcp`, using Streamable HTTP and OAuth authorization-code sign-in with PKCE. It runs inside HireMe; no separate process, database migration or model API key is needed for the connector. Clients can write application drafts with their own models. HireMe's `draft_application` needs a configured AI provider, and external job searches need a job source configured in HireMe.

## Enable and connect

1. Run HireMe normally (`yarn dev` for development, or your existing deployment).
2. Open **Settings → MCP connector**, enable **Let apps connect**, and copy its address.
3. Add the address to your MCP client and sign in with HireMe. For clients other than Claude, add their exact OAuth callback URL under **Other apps** before connecting. A rejected registration's callback must be added and registration retried.
4. Test with “Show my HireMe dashboard”, then “List my saved jobs”.

For local desktop clients the address is usually `http://localhost:3000/api/mcp`; use the address shown in Settings when you use another port. Hosted clients need a reachable HTTPS deployment. Set `HIREME_PUBLIC_URL` to that deployment's external origin, not the `/api/mcp` path, so OAuth metadata and links use the correct address. Do not disable authentication to make a client connect.

### OpenBot (openbot.run)

Add a custom **HTTP** MCP server called `HireMe` with the copied address in OpenBot, then choose **Sign in**. OpenBot supports OAuth for external HTTP MCP servers and passes authenticated tools to its agents. Its normal callback is `http://127.0.0.1:28417/mcp-auth`; add this under HireMe's **Other apps**. OpenBot can select a different port if that port is occupied, or retry with `localhost`; use the exact callback it shows. A legacy `openbot://mcp-auth` deep link is not accepted by HireMe: use a current OpenBot build with its HTTP loopback callback.

Choose the model/provider for your OpenBot agent separately from the HireMe MCP connection. A local OpenBot host can reach localhost HireMe. A remote OpenBot host needs an address reachable from that host. Restart an existing agent session if its tools have not refreshed.

Sources: [OpenBot integrations and sign-in](https://github.com/nightly-labs/openbot/blob/main/docs/architecture/integrations.md), [OpenBot callback listener](https://github.com/nightly-labs/openbot/blob/main/src/main/mcp-oauth-redirect-server.ts).

### Cursor

Merge this entry into `.cursor/mcp.json` in the workspace or `~/.cursor/mcp.json` for all workspaces; retain your other entries:

```json
{
  "mcpServers": {
    "hireme": {
      "url": "http://localhost:3000/api/mcp"
    }
  }
}
```

Use your actual HireMe address. Open Cursor's MCP settings and connect/sign in. Add the callback Cursor supplies to HireMe's **Other apps** if registration is refused. HireMe supports dynamic client registration; do not invent a client secret or use the HireMe password as an HTTP header.

Source: [Cursor MCP documentation](https://cursor.com/docs/mcp).

### ChatGPT

In ChatGPT on the web, add a custom MCP server, enter the public HTTPS HireMe endpoint, and select OAuth authentication with dynamic client registration. Add the exact callback URL ChatGPT gives you to HireMe's **Other apps**, then connect and authorize. Install/enable the resulting custom app/plugin in your conversation. Availability and UI labels depend on your account and workspace permissions.

Source: [Official OpenAI documentation: add a custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server).

### Grok Bot

In **Connect apps → Add a custom connector**, set **Name** to `HireMe`, **Type** to `Remote HTTPS`, and **Server URL** to your current public HireMe endpoint ending in `/api/mcp`. Leave **HTTP headers** and **Client ID** empty to use OAuth discovery and dynamic client registration. Choose **Add plugin**, then **Authorize/Authenticate**, sign in to HireMe and press **Allow**. Attach HireMe with `@` in the Bot's chat and ask it to read your dashboard.

Allow the exact callback requested by the client in HireMe's **Other apps**. The published client metadata currently lists `https://www.cursor.com/bot/mcp/oauth/callback`, `https://www.cursor.com/agents/mcp/oauth/callback`, and `https://grok.com/connectors-oauth-exchange-code/`. Only add the exact trusted addresses; if a client uses another address, check its source before adding it. These callbacks and ChatGPT's published `https://chatgpt.com/connector_platform_oauth_redirect` have been added to this local HireMe instance. Callback settings are local server data, not built-in defaults in the source code.

Sources: [Official Grok Bot connection instructions](https://docs.x.ai/grok-bot/computer-and-apps), [published client metadata](https://cursor.com/oauth/mcp-client.json), [ChatGPT client metadata](https://chatgpt.com/oauth/client.json).

### DeepSeek

Connect HireMe through an MCP-capable host that runs a DeepSeek model, for example OpenBot with an OpenAI-compatible provider. Configure DeepSeek credentials in that host, separately from the OAuth connection to HireMe. DeepSeek API model selection alone does not establish an MCP connection. This implementation does not claim or require that the standalone DeepSeek chat website can register custom MCP servers.

### Claude

Use the same URL in Claude's custom connectors, or run:

```sh
claude mcp add --transport http hireme http://localhost:3000/api/mcp
```

Then use `/mcp` to sign in. Claude's hosted apps require a publicly reachable endpoint.

## Tools

| Tool | Purpose |
| --- | --- |
| `get_dashboard` | Totals by status, funnel, activity, follow-ups and interviews; optional `period`: `30d`, `90d`, `all` |
| `get_profile` | Profile facts and IDs, excluding contact details |
| `search_jobs` | Search the configured external source; returns `search_id` and numbered results |
| `more_jobs` | Fetch another source page; may consume source quota |
| `list_job_searches` | Pull saved search history without a new external search |
| `list_jobs` | Pull `saved` / `dismissed` jobs, or a retained search by `search_id` |
| `get_posting` | Read the full posting by ID, search number, or URL |
| `set_job_state` | Mark a posting `saved` or `dismissed`; saving restores a dismissed posting |
| `save_job_scores` | Save model-written fit scores and reasons |
| `list_applications` | Filter by status and company/role/title `query`; page with `offset` / `limit` |
| `get_application` | Read posting, match and documents without private notes or letter contact fields |
| `get_application_history` | Read paginated status transitions |
| `track_application` | Record an application made elsewhere, without generating documents |
| `update_application` | Edit supplied title, company, role, location, mode, salary, deadline or posting URL |
| `set_application_status` | Move the card, preserving sent date, funnel and status events |
| `set_application_archived` | Archive or restore a card, retaining its data and activity date |
| `add_application_note` | Append a private tracking note; notes are not read back through MCP |
| `save_application` | Save model-written resume and cover letter, with existing fact checks |
| `draft_application` | Ask HireMe's configured AI to create a draft |
| `check_draft` | Check the background draft's progress |

`list_jobs`, `list_job_searches` and `get_application_history` return `next_offset` (null when finished); pass it as `offset` on the next call. `list_applications` keeps its existing array response: advance `offset` by `limit` until a shorter page is returned. Search result numbers retain their original positions across pages.

## Examples

“Search remote Android jobs in Germany, save the strongest matches, and prepare a draft for the first one.”

“I applied to Acme for Senior Android Engineer on their website. Record it as applied.” The client calls:

```json
{
  "name": "track_application",
  "arguments": {
    "idempotency_key": "acme-senior-android-2026-11-12",
    "company": "Acme",
    "role": "Senior Android Engineer",
    "posting_url": "https://careers.example/jobs/123",
    "status": "SENT",
    "note": "Applied on the company website."
  }
}
```

Keep the returned application `id`. Reuse the same `idempotency_key` if the request times out or is retried; concurrent retries create one card. An optional `posting_id` links a stored job, and an already linked posting returns its existing card. Distinct keys without a linked posting create distinct cards, even when their URLs match. Status updates are recorded at the time of the call; historical application dates are not backdated by this tool.

“Acme rejected me. Update that application and add the rejection reason.” Call `set_application_status` with the returned ID and `REJECTED`, then `add_application_note` with the factual reason. Status codes are `DRAFT`, `SENT` (already applied), `SCREENING`, `INTERVIEW`, `OFFER`, `ACCEPTED`, `REJECTED`, `DECLINED`.

“Archive that rejection” calls `set_application_archived` with `archived: true`; `false` restores it. `update_application` changes only supplied fields; `deadline: null` clears the date.

## Access and boundaries

The connector controls job discovery and application tracking. It does not expose database queries, secrets, password changes, destructive deletion, mail sending, automatic application submission, profile editing, or arbitrary settings changes. Interview times and Google account actions remain in HireMe's UI. Connected apps share the same authorized tool set. Private notes and profile contact fields remain excluded from read responses; posting text and employer-provided content may themselves contain contact information.

Turn the connector off or use **Disconnect all apps** to invalidate its tokens. Changing the password or `HIREME_SECRET` does too. Searches can use provider quota, and tools that fetch postings make network requests. Data returned to an app is processed by that app and its selected model provider.

The connection instructions describe supported protocols and configuration; signing in to each client and refreshing its tool list still needs to happen in that client. See [PRIVACY.md](../PRIVACY.md).

## Local macOS HTTPS tunnel

For a temporary public HTTPS endpoint, install `cloudflared` (`brew install cloudflared`), leave HireMe running, and run:

```sh
bash scripts/macos/tunnel.sh start
bash scripts/macos/tunnel.sh status
```

The status command prints the current `https://…trycloudflare.com` origin. Add `/api/mcp` and use it in ChatGPT's **Server URL** field with **OAuth** authentication. This is a Cloudflare HTTPS tunnel, not OpenAI's separate **Tunnel** connection type. Add ChatGPT's exact OAuth callback address under HireMe's Other apps before connecting. With no `HIREME_PUBLIC_URL` override, HireMe derives the correct public OAuth URLs from the request; an existing override must match the address being used.

The tunnel runs as a macOS user LaunchAgent and starts again when you sign in. Its hostname changes when the tunnel process is restarted; update ChatGPT's server URL after a restart. Keep HireMe running and the Mac awake for requests to succeed. Stop it and disable startup with:

```sh
bash scripts/macos/tunnel.sh stop
```

The service configuration is at `~/Library/LaunchAgents/me.hireme.tunnel.plist` and its log at `~/Library/Logs/HireMe-tunnel.log`. Authentication stays enabled. A stable hostname needs a named tunnel and a domain. Cloudflare Quick Tunnels are intended for testing and do not support long-lived SSE; this HireMe endpoint's single-result MCP requests must be verified through the tunnel, and this setup is not intended for subscriptions or streaming notifications.

Source: [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/quick-tunnels/).
