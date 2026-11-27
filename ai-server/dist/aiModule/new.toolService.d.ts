import OpenAI from 'openai';
import type { ChatStreamChunk, StreamChatOptions } from './config';
type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ReflectionPhase = 'review' | 'evaluate' | 'correct' | 'replan';
export type AgentStreamChunk = ChatStreamChunk | {
    type: 'reflection';
    phase: ReflectionPhase;
    agentRound: number;
    reflectionRound: number;
    content: string;
};
export interface AgentPermissionPolicy {
    permissions?: readonly string[];
    allowedTools?: readonly string[];
}
export interface AgentLimits {
    timeoutMs: number;
    maxAgentRounds: number;
    maxReflectionRounds: number;
    maxToolCallsPerRound: number;
    maxModelRequests: number;
    maxInputTokensPerRequest: number;
    maxOutputTokensPerRequest: number;
    maxTotalTokens: number;
    maxToolResultChars: number;
}
export interface ReActReflectionOptions extends StreamChatOptions {
    policy?: AgentPermissionPolicy;
    limits?: Partial<AgentLimits>;
    emitReflectionEvents?: boolean;
}
export declare class NewToolService {
    private readonly openai;
    private readonly config;
    constructor();
    streamChat(messages: Message[], options?: ReActReflectionOptions): AsyncGenerator<AgentStreamChunk>;
    private runModelRound;
    private reflect;
    private parseReflection;
    private executeToolCalls;
    private appendRoundMessages;
    private getAuthorizedTools;
    private assertToolAuthorized;
    private getToolDefinitions;
    private resolveLimits;
    private assertActive;
    private toErrorChunk;
}
export {};
