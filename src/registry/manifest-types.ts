export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPToolManifest {
  tools: MCPToolDefinition[];
}

export interface MCPContent {
  type: "text";
  text: string;
}
