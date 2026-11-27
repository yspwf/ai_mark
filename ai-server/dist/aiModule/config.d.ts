import type { CompletionUsage } from "openai/resources";
export type ChatStreamChunk = {
    type: 'content';
    content: string;
} | {
    type: 'done';
    finishReason: string | null;
    usage?: CompletionUsage;
    durationMs: number;
} | {
    type: 'error';
    code: string;
    message: string;
    retryable: boolean;
};
export interface AIServiceConfig {
    timeoutMs?: number;
    maxRetries?: number;
    maxInputTokens?: number;
    totalTokenCircuitBreaker?: number;
    baseRetryDelayMs?: number;
    model?: string;
}
export interface StreamChatOptions {
    signal?: AbortSignal;
    userId?: string;
    model?: string;
}
