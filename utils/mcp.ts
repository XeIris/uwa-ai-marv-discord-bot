import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { log, logError, logWarning } from './log';

const EXA_MCP_URL = process.env.EXA_MCP_URL || 'https://mcp.exa.ai/mcp';

const MCP_REQUEST_TIMEOUT_MS = 15_000;
const MAX_TOOL_CONTENT_CHARS = 4_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export interface McpToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export type McpCallResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

type State = 'disconnected' | 'connecting' | 'ready' | 'crashed';

let client: Client | null = null;
let transport: StreamableHTTPClientTransport | null = null;
let state: State = 'disconnected';
let nextRetryAt = 0;
let consecutiveFailures = 0;
let inflightConnect: Promise<void> | null = null;
let loggedToolList = false;
let isShuttingDown = false;
// Map sanitized public name → real MCP tool name. The model never sees "exa".
const toolNameMap = new Map<string, string>();

function sanitizeName(raw: string): string {
  let s = raw
    .replace(/exa/gi, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!s) s = 'tool';
  return s;
}

function sanitizeText(raw: string): string {
  return (raw || '').replace(/exa/gi, 'web search').replace(/\s{2,}/g, ' ').trim();
}

function computeBackoffMs(): number {
  const exp = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** consecutiveFailures);
  // ±20% jitter to avoid thundering-herd reconnects when many clients fail at once.
  const jitterFactor = 1 + (Math.random() * 0.4 - 0.2);
  const jittered = exp * jitterFactor;
  return Math.max(0, Math.min(RECONNECT_MAX_MS, jittered));
}

async function connect(): Promise<void> {
  if (state === 'ready' && client) return;
  if (state === 'connecting' && inflightConnect) {
    await inflightConnect;
    return;
  }
  if (state === 'crashed' && Date.now() < nextRetryAt) {
    throw new Error('MCP server in backoff window');
  }

  state = 'connecting';
  inflightConnect = (async () => {
    try {
      transport = new StreamableHTTPClientTransport(new URL(EXA_MCP_URL));
      client = new Client({ name: 'silverwolf', version: '1.0.0' }, { capabilities: {} });

      transport.onclose = () => {
        if (isShuttingDown) return;
        logWarning('[mcp] transport closed');
        state = 'crashed';
        consecutiveFailures += 1;
        nextRetryAt = Date.now() + computeBackoffMs();
        client = null;
        transport = null;
      };
      transport.onerror = (err) => {
        logError('[mcp] transport error:', err);
      };

      await client.connect(transport);
      state = 'ready';
      consecutiveFailures = 0;
      nextRetryAt = 0;
      log(`[mcp] connected via streamable HTTP: ${EXA_MCP_URL}`);
    } catch (err) {
      state = 'crashed';
      consecutiveFailures += 1;
      nextRetryAt = Date.now() + computeBackoffMs();
      client = null;
      transport = null;
      throw err;
    } finally {
      inflightConnect = null;
    }
  })();
  await inflightConnect;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

interface SanitizedTool {
  publicName: string;
  realName: string;
  description: string;
  parameters: Record<string, any>;
}

async function listSanitizedTools(): Promise<SanitizedTool[]> {
  await connect();
  if (!client) return [];
  const res = await withTimeout(client.listTools(), MCP_REQUEST_TIMEOUT_MS, '[mcp] tools/list');

  toolNameMap.clear();
  const sanitized: SanitizedTool[] = res.tools.map((t: any) => {
    const base = sanitizeName(t.name);
    let publicName = base;
    let suffix = 1;
    // Disambiguate collisions so the model can address each tool unambiguously.
    while (toolNameMap.has(publicName)) {
      publicName = `${base}-${suffix}`;
      suffix += 1;
    }
    toolNameMap.set(publicName, t.name);
    return {
      publicName,
      realName: t.name,
      description: sanitizeText(t.description ?? ''),
      parameters: t.inputSchema ?? { type: 'object', properties: {} },
    };
  });

  if (!loggedToolList) {
    const summary = sanitized.map((t) => `  - ${t.publicName} (real: ${t.realName}): ${t.description.slice(0, 120)}`).join('\n');
    log(`[mcp] tools/list returned ${sanitized.length} tool(s):\n${summary}`);
    loggedToolList = true;
  }

  return sanitized;
}

export async function listSearchTools(): Promise<McpToolDefinition[]> {
  try {
    const sanitized = await listSanitizedTools();
    return sanitized.map((t) => ({
      type: 'function',
      function: {
        name: t.publicName,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  } catch (err) {
    logError('[mcp] listSearchTools failed:', err);
    return [];
  }
}

// Gemini's Schema type expects uppercase type names ("STRING", "OBJECT"...) and
// rejects some JSON Schema fields like $schema/additionalProperties.
function toGeminiSchema(s: any): any {
  if (!s || typeof s !== 'object') return s;
  const out: any = { ...s };
  if (typeof out.type === 'string') out.type = out.type.toUpperCase();
  if (out.properties && typeof out.properties === 'object') {
    const newProps: Record<string, any> = {};
    for (const [k, v] of Object.entries(out.properties)) {
      newProps[k] = toGeminiSchema(v);
    }
    out.properties = newProps;
  }
  if (out.items) out.items = toGeminiSchema(out.items);
  delete out.$schema;
  delete out.additionalProperties;
  return out;
}

export async function listSearchToolsGemini(): Promise<{ functionDeclarations: any[] }[]> {
  try {
    const sanitized = await listSanitizedTools();
    if (sanitized.length === 0) return [];
    return [{
      functionDeclarations: sanitized.map((t) => ({
        name: t.publicName,
        description: t.description,
        parameters: toGeminiSchema(t.parameters),
      })),
    }];
  } catch (err) {
    logError('[mcp] listSearchToolsGemini failed:', err);
    return [];
  }
}

export async function callSearchTool(name: string, args: Record<string, any>): Promise<McpCallResult> {
  try {
    await connect();
    if (!client) return { ok: false, error: 'MCP client unavailable' };
    const realName = toolNameMap.get(name) ?? name;
    log(`[mcp] tools/call ${realName} (as ${name}) ${JSON.stringify(args).slice(0, 200)}`);
    const res: any = await withTimeout(
      client.callTool({ name: realName, arguments: args }),
      MCP_REQUEST_TIMEOUT_MS,
      `[mcp] tools/call ${realName}`,
    );

    const parts: string[] = (res?.content ?? [])
      .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
      .filter((s: string) => s.length > 0);
    let joined = parts.join('\n').trim();
    if (!joined) return { ok: true, content: 'No results.' };
    // Scrub provider name from result text so the model doesn't echo it back.
    joined = joined.replace(/exa/gi, 'web search');
    const truncated = joined.length > MAX_TOOL_CONTENT_CHARS
      ? `${joined.slice(0, MAX_TOOL_CONTENT_CHARS)}\n[…truncated]`
      : joined;
    return { ok: true, content: truncated };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(`[mcp] callSearchTool ${name} failed:`, err);
    return { ok: false, error: msg };
  }
}

export async function shutdownMcp(): Promise<void> {
  isShuttingDown = true;
  try {
    if (client) {
      try { await client.close(); } catch (err) { logError('[mcp] close failed:', err); }
    }
    client = null;
    transport = null;
    state = 'disconnected';
  } finally {
    isShuttingDown = false;
  }
}
