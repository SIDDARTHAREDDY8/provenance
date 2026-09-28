export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface StructuredRequest {
  /** Stable identity for this call, used to look up or record a fixture. */
  cacheKey: string;
  system?: string;
  prompt: string;
  tool: ToolSchema;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  /** Number of model calls made, for the trace. */
  readonly calls: number;
  structured<T>(req: StructuredRequest): Promise<T>;
}
