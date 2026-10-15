/**
 * Board Clerk — Streamable HTTP MCP server on Cloudflare Workers.
 * Synthetic fixtures only. No model or email calls.
 * Origin allowlist and the 256 KB body cap are the DNS-rebinding / DoS controls for /mcp.
 */
import { DEMO_HTML } from "./ui/demo-html.js";
import { DEMO_TRANSCRIPT } from "./ui/demo-transcript.js";
import { BoardState } from "./state.js";
import { createHandler, healthBody } from "./server.js";

export { BoardState };

const MAX_MCP_BODY = 256 * 1024;

function isLoopbackHttp(originUrl) {
  return originUrl.protocol === "http:" && (originUrl.hostname === "localhost" || originUrl.hostname === "127.0.0.1");
}

function originAllowed(request) {
  const header = request.headers.get("origin");
  if (header == null || header === "") return true;
  if (header === "null") return false;
  let originUrl;
  try {
    originUrl = new URL(header);
  } catch {
    return false;
  }
  if (originUrl.origin === "null" || originUrl.protocol === "null:") return false;
  if (isLoopbackHttp(originUrl)) return true;
  // Same-origin is trusted only for the deployed workers.dev hostname.
  // Matching the request URL alone would allow a DNS-rebound name
  // (Origin and URL both evil.example, pointed at local wrangler).
  let own;
  try {
    own = new URL(request.url);
  } catch {
    return false;
  }
  const host = originUrl.hostname;
  return originUrl.origin === own.origin && host.endsWith(".workers.dev") && host === own.hostname;
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
}

async function readLimited(request, max) {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try {
        await reader.cancel();
      } catch {
        /* already over the cap */
      }
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response(JSON.stringify(healthBody()), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (request.method === "GET" && url.pathname === "/demo") {
      return new Response(DEMO_HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy":
            "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'",
          "referrer-policy": "no-referrer",
        },
      });
    }
    if (request.method === "GET" && url.pathname === "/demo/transcript.txt") {
      return new Response(DEMO_TRANSCRIPT, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    // createMcpHandler (SDK 2.3.1) is path-agnostic: it has no route option.
    // Origin and body limits must not be skippable via POST / or /mcp/.
    if (url.pathname !== "/mcp") return jsonError("not found", 404);
    if (!originAllowed(request)) return jsonError("origin not allowed", 403);
    if (request.method === "POST") {
      const declared = request.headers.get("content-length");
      if (declared != null && declared !== "" && Number(declared) > MAX_MCP_BODY) {
        return jsonError("request body exceeds 256 KB", 413);
      }
      const bytes = await readLimited(request, MAX_MCP_BODY);
      if (bytes == null) return jsonError("request body exceeds 256 KB", 413);
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      if (bytes.byteLength) headers.set("content-length", String(bytes.byteLength));
      request = new Request(request.url, {
        method: "POST",
        headers,
        body: bytes.byteLength ? bytes : undefined,
      });
    }
    const handler = createHandler({ env });
    return handler.fetch(request);
  },
};
