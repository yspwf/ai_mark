// 类型定义

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
    /** 请求超时时间，毫秒 */
    timeoutMs?: number;
    /** 最大重试次数 */
    maxRetries?: number;
    /** 单次请求最大输入 token 预估阈值 */
    maxInputTokens?: number;
    /** 实例级累计 token 熔断阈值，超过直接拒绝服务 */
    totalTokenCircuitBreaker?: number;
    /** 初始重试延迟，毫秒 */
    baseRetryDelayMs?: number;
    /** 模型名称 */
    model?: string;
}

export interface StreamChatOptions {
    /** 外部取消信号 */
    signal?: AbortSignal;
    /** 本次请求的用户标识，用于限流/日志 */
    userId?: string;
    /** 强制覆盖模型 */
    model?: string;
}



