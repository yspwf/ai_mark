type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
interface ToolFunction {
    name: string;
    description?: string;
    parameters: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}
interface Tool {
    type: 'function';
    function: ToolFunction;
}
type ToolHandler = (args: Record<string, unknown>) => Promise<JsonValue> | JsonValue;
type FunctionsMap = Record<string, ToolHandler>;
interface AgentOptions {
    apiKey?: string;
    model?: string;
    tools?: Tool[];
    functions?: FunctionsMap;
    maxIterations?: number;
    maxRetries?: number;
    stream?: boolean;
    systemPrompt?: string;
    onToken?: (token: string) => void;
}
interface RunOptions {
    onToken?: (token: string) => void;
    stream?: boolean;
}
declare class OpenAIAgent {
    private client;
    private model;
    private tools;
    private functions;
    private maxIterations;
    private maxRetries;
    private stream;
    private systemPrompt?;
    private onToken?;
    constructor(options?: AgentOptions);
    private createCompletion;
    private isRetryable;
    private accumulateToolCalls;
    private buildToolCalls;
    private executeTool;
    run(userMessage: string, options?: RunOptions): Promise<string>;
}
export { OpenAIAgent };
export type { Tool, ToolFunction, ToolHandler, FunctionsMap, AgentOptions, JsonValue };
