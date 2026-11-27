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
type RuleEffect = 'allow' | 'deny';
interface PermissionRule {
    tool: string | RegExp;
    param?: string;
    paramPattern?: string | RegExp;
    effect: RuleEffect;
    reason?: string;
}
interface GuardConfig {
    maxIterations?: number;
    maxToolCallsPerRun?: number;
    llmTimeoutMs?: number;
    toolTimeoutMs?: number;
    totalTimeoutMs?: number;
    rules?: PermissionRule[];
    maxBudgetUsd?: number;
    maxTokensPerRequest?: number;
}
interface ReflectionResult {
    verdict: 'continue' | 'correct' | 'replan' | 'stop';
    issues: string[];
    corrections: string[];
    replanStrategy?: string;
    confidence: number;
}
type ToolCallEvent = {
    type: 'start';
    index: number;
} | {
    type: 'delta';
    index: number;
    name?: string;
    argsChunk?: string;
} | {
    type: 'complete';
    index: number;
    name: string;
    fullArgs: string;
} | {
    type: 'executed';
    name: string;
    success: boolean;
    durationMs: number;
    output: string;
};
interface AgentOptions extends GuardConfig {
    apiKey?: string;
    model?: string;
    tools?: Tool[];
    functions?: FunctionsMap;
    stream?: boolean;
    systemPrompt?: string;
    onToken?: (token: string) => void;
    onToolCall?: (event: ToolCallEvent) => void;
    enableReflection?: boolean;
    reflectionModel?: string;
    reflectionInterval?: number;
}
interface RunOptions {
    onToken?: (token: string) => void;
    stream?: boolean;
}
interface ToolExecutionResult {
    success: boolean;
    output: string;
    durationMs: number;
    denied?: boolean;
    reason?: string;
}
interface CostTracker {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    estimatedCostUsd: number;
}
declare class EnterpriseAgent {
    private client;
    private model;
    private tools;
    private functions;
    private stream;
    private systemPrompt?;
    private onToken?;
    private onToolCall?;
    private maxIterations;
    private maxToolCallsPerRun;
    private llmTimeoutMs;
    private toolTimeoutMs;
    private totalTimeoutMs;
    private rules;
    private maxBudgetUsd;
    private maxTokensPerRequest;
    private enableReflection;
    private reflectionModel;
    private reflectionInterval;
    private cost;
    constructor(options?: AgentOptions);
    private trackUsage;
    private checkBudget;
    private checkPermission;
    private withTimeout;
    private createCompletion;
    private isRetryable;
    private accumulateToolCalls;
    private buildToolCalls;
    private executeTool;
    private reflect;
    run(userMessage: string, options?: RunOptions): Promise<string>;
    private _runInternal;
    getCost(): CostTracker;
}
export { EnterpriseAgent };
export type { Tool, ToolFunction, ToolHandler, FunctionsMap, AgentOptions, JsonValue, PermissionRule, GuardConfig, ReflectionResult, ToolExecutionResult, CostTracker, ToolCallEvent, };
