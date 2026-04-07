import { ServiceEntry } from "./registry-client.js";
import { MCPToolManifest, MCPToolDefinition } from "./manifest-types.js";

/**
 * Sanitizes a URL into a safe MCP tool name.
 * Replaces non-alphanumeric chars with _, strips protocol prefix, max 60 chars.
 */
export function sanitizeToolName(url: string): string {
  const clean = url
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-z0-9]/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  return clean.slice(0, 60).toLowerCase();
}

/**
 * Safely parses a JSON schema string.
 */
function parseInputSchema(schemaStr: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(schemaStr);
    return parsed.properties || {};
  } catch {
    return {};
  }
}

/**
 * Extracts required fields from a JSON schema string.
 */
function extractRequiredFields(schemaStr: string): string[] {
  try {
    const parsed = JSON.parse(schemaStr);
    return Array.isArray(parsed.required) ? parsed.required : [];
  } catch {
    return [];
  }
}

/**
 * Generates an MCP manifest from a list of registry service entries.
 */
export function generateMCPManifest(services: ServiceEntry[]): MCPToolManifest {
  const tools: MCPToolDefinition[] = services.map(service => {
    const properties = parseInputSchema(service.inputSchema);
    const required = extractRequiredFields(service.inputSchema);

    // Inject override capability
    const finalProperties = {
      ...properties,
      _overrideUrl: {
        type: "string",
        description: "Optional: override the service URL for this call"
      }
    };

    return {
      name: sanitizeToolName(service.url),
      description: `${service.name} — ${service.description} | Price: ${service.priceUsdc.toString()} stroops USDC`,
      inputSchema: {
        type: "object",
        properties: finalProperties,
        required
      }
    };
  });

  return { tools };
}
