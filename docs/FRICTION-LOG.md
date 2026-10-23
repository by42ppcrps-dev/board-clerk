# Friction log

Board Clerk for Alexa+ (Amazon Build, Ship, Shape hackathon, Alexa+ track). Format per the event rules: task, steps, expected vs actual, severity, workaround, suggestion. Times are estimates.

## 1. MCP server answered on paths we never mounted
- Task: serve MCP only at `/mcp` on a Cloudflare Worker.
- Steps: created the handler with `createMcpHandler` from `@modelcontextprotocol/server` 2.3.1, passed `route: "/mcp"`, and forwarded requests from the Worker's fetch handler.
- Expected: tool calls only on `/mcp`, everything else 404.
- Actual: tools ran on `POST /` and `POST /mcp/` too. The options type has no `route` field, so the value was ignored. Our Origin check and body cap only wrapped `/mcp`, so those other paths skipped them.
- Severity: High (security controls could be bypassed).
- Workaround: our own router that returns 404 for every path except `/`, `/health`, `/demo`, `/demo/transcript.txt` and `/mcp`.
- Suggestion: one line in the Workers getting-started sample saying the handler is path-agnostic and the app must route, plus a type error if `route` is passed.

## 2. No Origin validation by default, and our first allowlist was bypassable
- Task: meet the 2025-11-25 transport rule that servers validate `Origin`.
- Steps: wrote a custom allowlist that treated "same as the request URL" as our own origin.
- Expected: requests from other sites rejected.
- Actual: the handler does no Origin checks on purpose. Our first allowlist let a DNS-rebinding hostname pointed at local `wrangler dev` through. The SDK already exports `originValidationResponse` and `validateOriginHeader`, but the sample does not use them.
- Severity: High.
- Workaround: fixed allowlist (exact deployed host plus localhost rules), rejects `Origin: null` and https localhost, and the 403 does not echo the Origin.
- Suggestion: call `originValidationResponse` in the Workers example by default, include a DNS-rebinding test, and accept an extra hostname for a deployed host.

## 3. Nowhere to keep household state for a stateless server
- Task: let a board's confirmations and meetings survive across assistant sessions.
- Steps: started with a stateless Streamable HTTP handler, considered Workers KV, then moved to a SQLite Durable Object per board.
- Expected: Alexa+ docs to say where a self-hosted MCP server should keep per-household state.
- Actual: Amazon documents account linking and authentication for add-ons, but nothing we found says where a self-hosted MCP server should keep per-household state such as meeting records. The HTTP session does not keep it.
- Severity: Medium (about half a day lost choosing and wiring storage).
- Workaround: one Durable Object per `board_id`.
- Suggestion: a short Alexa+ page on per-household state for remote MCP servers, with a Durable Object or DynamoDB example.

## 4. No path from the event rules to a real Alexa+ device
- Task: run the server behind a real Alexa+ device.
- Steps: read the rules and the resources page (Agent Skills, Streamable HTTP).
- Expected: a click path to attach a third-party remote MCP server to a device.
- Actual: we found Amazon's add-on toolkit docs (including the Local Inspector), but no path to attach a third-party remote MCP server to a real device during the event, so we built a simulated web page instead, as the rules allow.
- Severity: Medium (about 2 hours, and no device test).
- Workaround: simulated Alexa+ page that is a real MCP client, labelled as simulated on screen.
- Suggestion: a single page that either shows the attach steps or says device attach is not available during the event.

## 5. Inspector CLI output buried the useful data
- Task: chain calls in MCP Inspector CLI (create an approval request, then approve it by id).
- Steps: ran `tools/call` against the remote server and read the result.
- Expected: easy access to returned ids.
- Actual: the CLI shows the text content first, and pulling an id out of text was awkward.
- Severity: Low (under an hour).
- Workaround: return `structuredContent` alongside text from every tool.
- Suggestion: print `structuredContent` first in the CLI when it is present.

## 6. Wrangler login lost after a machine restore
- Task: deploy from a headless build machine.
- Steps: `wrangler login` (OAuth), then the machine was restored from a snapshot.
- Expected: login to survive, or a clear message.
- Actual: the login was gone and the deploy failed until we created an API token. Wrangler 3.114 also printed an upgrade-to-4 warning with no note on what breaks if you stay.
- Severity: Low to Medium (30 to 60 minutes, deploy blocked meanwhile).
- Workaround: scoped API token in the environment.
- Suggestion: point headless users to the token path in the login error, and say what changes in Wrangler 4.
