# Product feedback

Draft from the October 5 and October 11, 2026 build. Each note is something we hit. Estimates are labeled. Items marked observed once were not reproduced again. Details are in [FRICTION-LOG.md](FRICTION-LOG.md).

## MCP TypeScript server SDK (`@modelcontextprotocol/server` 2.3.1)

`createMcpHandler` in 2.3.1 has no `route` option. We passed `route: "/mcp"` and it was ignored. Tools ran on `POST /` and `POST /mcp/` until our worker returned 404 for every path except the ones it lists (2026-10-11, reproduced in review). The handler entry is validation-free on purpose. Origin helpers are in the same package (`originValidationResponse`, `validateOriginHeader`). We did not use them. Our first allowlist was DNS-rebinding-bypassable. Time lost: estimate, a few hours across both.

What would have helped: a Workers sample that mounts one pathname and calls `originValidationResponse`, plus a DNS-rebinding test. Not a `route` string the types do not accept.

## MCP Inspector

On 2026-10-11 the CLI completed `tools/call` against the remote server, and a JSON array argument (roster) worked. Observed once. No Inspector transcript is in this repo. Extracting an id from text content was awkward. `structuredContent` is what made the approval id usable. Time lost: estimate, under an hour.

What would have helped: show `structuredContent` first in the CLI output.

## Cloudflare Workers and Durable Objects

Streamable HTTP does not keep board memory across sessions. On 2026-10-05 the status note still had a KV binding as not done. On 2026-10-11 state went into a SQLite Durable Object, one per `board_id`. That part is the design we shipped, not a one-time glitch. Time lost: estimate, about half a day.

What would have helped: a short note on which binding to use for small per-key JSON (meetings, confirms, approvals, a short audit log) when the HTTP session is stateless.

## Wrangler 3.114

On 2026-10-11 it printed an upgrade-to-4 warning. Observed once, and the warning text is not saved here: OAuth login on a headless box did not survive a machine restore, and an API token was needed. Time lost: estimate, 30 to 60 minutes.

What would have helped: a headless login path that survives a restore, and a warning that says that before the deploy fails.

## Alexa+ docs

Two gaps, both observed once on 2026-10-11. We found no guidance on where per-household state should live for a self-hosted MCP server. The event rules allow a self-hosted server or a simulated experience. The resources page links Agent Skills and Streamable HTTP. We found no click-path there to attach a third-party remote MCP server to a real Alexa+ device, so we built the simulated page. Time lost: estimate, about 2 hours on the device question, on top of the state work above.

What would have helped: one page that says whether a remote MCP server can be connected to an Alexa+ device for this event, and where that server should store per-household state.
