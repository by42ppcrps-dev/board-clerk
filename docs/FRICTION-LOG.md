# Friction log

Draft from the October 5 and October 11, 2026 build. Times are estimates, not a stopwatch. "Observed once" means we did not reproduce it a second time.

## a. `createMcpHandler` is path-agnostic, and `route` is not an option

Date: 2026-10-11 for the extra paths. Corrected the same day after reading the installed SDK. The path bug was reproduced, then fixed in our router. The "broken route option" explanation was wrong.

What happened: tools ran on `POST /` and `POST /mcp/` as well as `POST /mcp` when the worker forwarded every path to the handler. Origin checks and the 256 KB cap only wrapped `pathname === "/mcp"`, so those other paths skipped them. We had passed `route: "/mcp"`. Installed `@modelcontextprotocol/server` 2.3.1 `CreateMcpHandlerOptions` has no `route` field. `createMcpHandler` reads `legacy`, `onerror`, `responseMode`, `bus`, `maxSubscriptions`, `keepAliveMs`, and `maxRequestBodySize`. The docs say the fetch handler is mounted by the app. Our `route` value was ignored because it is not an option, not because a route check failed.

Impact: estimate, about 1 to 2 hours to notice the extra paths and add our own router. After `GET /`, `GET /health`, `GET /demo`, and `GET /demo/transcript.txt`, any other path is 404. `/mcp` always runs the origin check and the body cap.

What would have helped: the getting-started sample saying, in one line, that `createMcpHandler` does not take a path and the worker must 404 every other pathname.

## b. `createMcpHandler` does not validate Origin, and our first allowlist was bypassable

Date: 2026-10-11. The bypass was reproduced in review (H1), then fixed. The "SDK has no Origin validation" part was wrong once we read the installed package. Not observed once for the bypass after the fix.

What happened: the 2025-11-25 transport spec says servers validate `Origin`. `createMcpHandler` is deliberately validation-free. Its own comment says to put Origin and Host checks in front of `fetch`. The same package exports `originValidationResponse`, `validateOriginHeader`, and `localhostAllowedOrigins`, and `WebStandardStreamableHTTPServerTransport` can check `allowedOrigins` when DNS-rebinding protection is turned on. We did not use those helpers. We wrote an allowlist. The first version treated "same as the request URL" as the worker's own origin. A DNS-rebind name pointed at local `wrangler dev` could send `Origin: http://evil.example` to `http://evil.example/mcp` and pass. `https://localhost` and `Origin: null` are rejected. A missing `Origin` is allowed. The 403 body does not echo `Origin`. The helpers' localhost lists would not have allowed our `https://*.workers.dev` host by themselves, so a custom rule was still required.

Impact: estimate, about 2 to 3 hours for the allowlist, plus about another hour after review showed the rebinding hole.

What would have helped: the Workers example calling `originValidationResponse` by default, with the DNS-rebinding case in its tests, and one extra hostname argument for a deployed host.

## c. Stateless Streamable HTTP, and no Alexa+ note on where household state lives

Date: 2026-10-05 the status note still listed a Workers KV binding as not done. Date: 2026-10-11 we stored state in a SQLite Durable Object, one instance per `board_id` (`BoardState`). The "no Alexa+ guidance" part was observed once.

What happened: a stateless Streamable HTTP handler does not keep confirmations or ingested meetings across sessions. Cross-session memory has to live somewhere else. We used the Durable Object. We did not find Alexa+ documentation that says where per-household state should live for a self-hosted MCP server.

Impact: estimate, about half a day choosing KV versus a Durable Object and wiring the DO. The docs gap did not get a second look.

What would have helped: one page that says where a self-hosted MCP server should keep per-household state, and that the HTTP session will not do it.

## d. No path from the event rules to a real Alexa+ device

Date: 2026-10-11. Observed once.

What happened: the event rules allow a self-hosted MCP server or a simulated experience. On the event resources page we found "Build with Agent Skills" and "Streamable HTTP transport", and no click-path we could follow to attach this remote server to a real Alexa+ device, so the demo is the simulated web page. We did not try a second time. This note is that we still have no device attach path.

Impact: estimate, about 2 hours reading the rules and deciding to build the page instead of blocking on a device.

What would have helped: a single page that either shows the click-path to attach a remote MCP server to an Alexa+ device, or says that path is not available during the event.

## e. Inspector CLI worked; text ids were awkward

Date: 2026-10-11. Observed once for the remote call. Not re-run against the public host in this round.

What happened: MCP Inspector CLI completed `tools/call` against the remote server. Passing a JSON array argument (the roster) worked. Pulling an id out of the text content was awkward. `structuredContent` on the tool result fixed that for clients that read it. No Inspector transcript is saved in this repo, so this item is an unreproduced note, not a log a judge can open.

Impact: estimate, under an hour.

What would have helped: Inspector printing `structuredContent` as the default result, and the SDK treating structured content as the normal tool result instead of an extra field beside a text blob.

## f. Wrangler 3.114 upgrade warning, and OAuth did not survive a restore

Date: 2026-10-11. Observed once.

What happened: Wrangler 3.114 printed a warning to upgrade to Wrangler 4. On a headless box, `wrangler` OAuth login did not survive a machine restore. An API token was required. This repo does not contain that token, and it does not contain the warning text. Treat this as an unreproduced note.

Impact: the warning is immediate. The login loss cost a second login. Estimate, 30 to 60 minutes, and it blocked deploy until a token existed.

What would have helped: login state that survives a restore, or a headless-first token path that the warning points at. A Wrangler 4 upgrade note that says what breaks if you stay on 3.114.
