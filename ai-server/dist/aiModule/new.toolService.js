"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NewToolService = void 0;
const common_1 = require("@nestjs/common");
const openai_1 = __importDefault(require("openai"));
const DEFAULT_LIMITS = {
    timeoutMs: 120_000,
    maxAgentRounds: 6,
    maxReflectionRounds: 2,
    maxToolCallsPerRound: 4,
    maxModelRequests: 18,
    maxInputTokensPerRequest: 8_000,
    maxOutputTokensPerRequest: 2_048,
    maxTotalTokens: 50_000,
    maxToolResultChars: 8_000,
};
const HARD_LIMITS = {
    timeoutMs: 300_000,
    maxAgentRounds: 12,
    maxReflectionRounds: 4,
    maxToolCallsPerRound: 8,
    maxModelRequests: 32,
    maxInputTokensPerRequest: 32_000,
    maxOutputTokensPerRequest: 8_192,
    maxTotalTokens: 200_000,
    maxToolResultChars: 16_000,
};
class AgentConstraintError extends Error {
    code;
    retryable;
    constructor(code, message, retryable = false) {
        super(message);
        this.code = code;
        this.retryable = retryable;
        this.name = 'AgentConstraintError';
    }
}
class CostGuard {
    limits;
    requestCount = 0;
    usageValue;
    constructor(limits) {
        this.limits = limits;
    }
    get usage() {
        return this.usageValue;
    }
    beginRequest(payload) {
        if (this.requestCount >= this.limits.maxModelRequests) {
            throw new AgentConstraintError('MODEL_REQUEST_LIMIT', `模型请求次数超过上限 ${this.limits.maxModelRequests}`);
        }
        const estimatedInputTokens = estimateTokens(JSON.stringify(payload));
        if (estimatedInputTokens > this.limits.maxInputTokensPerRequest) {
            throw new AgentConstraintError('INPUT_TOKEN_LIMIT', `单次输入预计 ${estimatedInputTokens} tokens，超过上限 ${this.limits.maxInputTokensPerRequest}`);
        }
        const consumed = this.usageValue?.total_tokens ?? 0;
        if (consumed + estimatedInputTokens > this.limits.maxTotalTokens) {
            throw new AgentConstraintError('TOTAL_TOKEN_LIMIT', `预计总 token 将超过上限 ${this.limits.maxTotalTokens}`);
        }
        this.requestCount += 1;
        return estimatedInputTokens;
    }
    finishRequest(usage, estimatedInputTokens, output) {
        const fallbackOutputTokens = estimateTokens(output);
        const measured = usage ?? {
            prompt_tokens: estimatedInputTokens,
            completion_tokens: fallbackOutputTokens,
            total_tokens: estimatedInputTokens + fallbackOutputTokens,
        };
        this.usageValue = mergeUsage(this.usageValue, measured);
        if (this.usageValue.total_tokens > this.limits.maxTotalTokens) {
            throw new AgentConstraintError('TOTAL_TOKEN_LIMIT', `累计消耗 ${this.usageValue.total_tokens} tokens，超过上限 ${this.limits.maxTotalTokens}`);
        }
    }
}
let NewToolService = class NewToolService {
    openai;
    config;
    constructor() {
        const apiKey = process.env.AI_API_KEY;
        if (!apiKey) {
            throw new Error('缺少环境变量 AI_API_KEY');
        }
        this.openai = new openai_1.default({
            apiKey,
            baseURL: process.env.AI_BASE_URL ?? 'https://api.siliconflow.cn/v1',
            timeout: DEFAULT_LIMITS.timeoutMs,
            maxRetries: 0,
        });
        this.config = {
            timeoutMs: DEFAULT_LIMITS.timeoutMs,
            maxRetries: 2,
            maxInputTokens: DEFAULT_LIMITS.maxInputTokensPerRequest,
            totalTokenCircuitBreaker: DEFAULT_LIMITS.maxTotalTokens,
            baseRetryDelayMs: 1_000,
            model: process.env.AI_MODEL ?? 'zai-org/GLM-5.3-Flash',
        };
    }
    async *streamChat(messages, options = {}) {
        const startedAt = performance.now();
        const limits = this.resolveLimits(options.limits);
        const timeoutSignal = AbortSignal.timeout(limits.timeoutMs);
        const signal = options.signal
            ? AbortSignal.any([options.signal, timeoutSignal])
            : timeoutSignal;
        const model = options.model ?? this.config.model;
        const budget = new CostGuard(limits);
        const workingMessages = [...messages];
        const authorizedTools = this.getAuthorizedTools(options.policy);
        let finalFinishReason = null;
        try {
            for (let agentRound = 1; agentRound <= limits.maxAgentRounds; agentRound += 1) {
                this.assertActive(signal, options.signal, timeoutSignal);
                const modelRound = await this.runModelRound(workingMessages, authorizedTools, model, signal, budget, limits);
                finalFinishReason = modelRound.finishReason;
                if (modelRound.toolCalls.length > limits.maxToolCallsPerRound) {
                    throw new AgentConstraintError('TOOL_CALL_LIMIT', `单轮工具调用数 ${modelRound.toolCalls.length} 超过上限 ${limits.maxToolCallsPerRound}`);
                }
                const toolResults = await this.executeToolCalls(modelRound.toolCalls, options.policy, signal, limits);
                let candidateAnswer = modelRound.content;
                let reflectionPassed = false;
                let replanInstruction = '';
                for (let reflectionRound = 1; reflectionRound <= limits.maxReflectionRounds; reflectionRound += 1) {
                    this.assertActive(signal, options.signal, timeoutSignal);
                    const decision = await this.reflect({
                        agentRound,
                        candidateAnswer,
                        finishReason: modelRound.finishReason,
                        toolCalls: modelRound.toolCalls.map((call) => ({
                            id: call.id,
                            name: call.function.name,
                            arguments: call.function.arguments,
                        })),
                        toolResults: toolResults.map((result) => ({
                            name: result.call.function.name,
                            succeeded: result.succeeded,
                            content: result.content,
                        })),
                    }, model, signal, budget, limits);
                    if (options.emitReflectionEvents) {
                        yield {
                            type: 'reflection',
                            phase: 'review',
                            agentRound,
                            reflectionRound,
                            content: decision.review,
                        };
                        yield {
                            type: 'reflection',
                            phase: 'evaluate',
                            agentRound,
                            reflectionRound,
                            content: JSON.stringify(decision.evaluation),
                        };
                        yield {
                            type: 'reflection',
                            phase: 'correct',
                            agentRound,
                            reflectionRound,
                            content: decision.correction.required
                                ? decision.correction.instruction
                                : '无需纠正',
                        };
                        yield {
                            type: 'reflection',
                            phase: 'replan',
                            agentRound,
                            reflectionRound,
                            content: decision.replan.instruction || '保持当前计划',
                        };
                    }
                    if (decision.correction.revisedAnswer !== undefined) {
                        candidateAnswer = decision.correction.revisedAnswer;
                    }
                    if (decision.evaluation.passed) {
                        reflectionPassed = true;
                        break;
                    }
                    replanInstruction = [
                        decision.correction.instruction,
                        decision.replan.instruction,
                        ...decision.evaluation.issues,
                    ]
                        .filter(Boolean)
                        .join('\n');
                    if (!decision.correction.revisedAnswer)
                        break;
                }
                if (!reflectionPassed) {
                    this.appendRoundMessages(workingMessages, modelRound, toolResults);
                    workingMessages.push({
                        role: 'developer',
                        content: `上一轮未通过反思校验。请修正偏差并重新规划。\n${replanInstruction}`,
                    });
                    continue;
                }
                if (modelRound.toolCalls.length > 0) {
                    this.appendRoundMessages(workingMessages, modelRound, toolResults);
                    continue;
                }
                if (candidateAnswer) {
                    yield { type: 'content', content: candidateAnswer };
                }
                yield {
                    type: 'done',
                    finishReason: finalFinishReason,
                    usage: budget.usage,
                    durationMs: performance.now() - startedAt,
                };
                return;
            }
            throw new AgentConstraintError('AGENT_ROUND_LIMIT', `Agent 执行超过 ${limits.maxAgentRounds} 轮，已熔断`);
        }
        catch (error) {
            yield this.toErrorChunk(error, options.signal, timeoutSignal);
        }
    }
    async runModelRound(messages, tools, model, signal, budget, limits) {
        const toolSchemas = tools.map((tool) => tool.schema);
        const estimatedInput = budget.beginRequest({ messages, tools: toolSchemas });
        let usage;
        let content = '';
        let usageRecorded = false;
        const pendingCalls = new Map();
        let finishReason = null;
        try {
            const stream = await this.openai.chat.completions.create({
                model,
                messages,
                stream: true,
                stream_options: { include_usage: true },
                max_tokens: limits.maxOutputTokensPerRequest,
                ...(toolSchemas.length > 0
                    ? { tools: toolSchemas, tool_choice: 'auto' }
                    : {}),
            }, { signal });
            for await (const chunk of stream) {
                if (signal.aborted)
                    throw signal.reason;
                if (chunk.usage)
                    usage = chunk.usage;
                const choice = chunk.choices.at(0);
                if (!choice)
                    continue;
                if (choice.finish_reason)
                    finishReason = choice.finish_reason;
                if (choice.delta.content)
                    content += choice.delta.content;
                for (const call of choice.delta.tool_calls ?? []) {
                    const pending = pendingCalls.get(call.index) ?? { arguments: '' };
                    if (call.id)
                        pending.id = call.id;
                    if (call.function?.name)
                        pending.name = call.function.name;
                    if (call.function?.arguments) {
                        pending.arguments += call.function.arguments;
                    }
                    pendingCalls.set(call.index, pending);
                }
            }
            if (finishReason === 'length' && pendingCalls.size > 0) {
                throw new AgentConstraintError('TOOL_CALL_TRUNCATED', '工具参数被输出上限截断，拒绝执行不完整调用');
            }
            const toolCalls = [...pendingCalls.entries()]
                .sort(([left], [right]) => left - right)
                .map(([, pending], index) => {
                if (!pending.id || !pending.name) {
                    throw new AgentConstraintError('INVALID_TOOL_CALL', `工具调用 #${index} 缺少 id 或 name`);
                }
                return {
                    id: pending.id,
                    type: 'function',
                    function: {
                        name: pending.name,
                        arguments: pending.arguments,
                    },
                };
            });
            usageRecorded = true;
            budget.finishRequest(usage, estimatedInput, content);
            return { content, finishReason, toolCalls };
        }
        finally {
            if (!usageRecorded) {
                budget.finishRequest(usage, estimatedInput, content);
            }
        }
    }
    async reflect(snapshot, model, signal, budget, limits) {
        const reflectionMessages = [
            {
                role: 'system',
                content: [
                    '你是企业 Agent 的独立审查器，不输出思维链，只输出审查结论。',
                    '严格执行 Review → Evaluate → Correct → Replan。',
                    'Review：核对目标、事实、工具调用和工具结果。',
                    'Evaluate：判断是否正确、安全、完整，给出 0-100 分和问题列表。',
                    'Correct：必要时给出修订答案或明确修正指令。',
                    'Replan：决定是否继续执行，并给出下一步指令。',
                    '只输出 JSON，不要 Markdown。',
                    '结构：{"review":"","evaluation":{"passed":true,"score":100,"issues":[]},"correction":{"required":false,"instruction":"","revisedAnswer":""},"replan":{"continue":false,"instruction":""}}',
                ].join('\n'),
            },
            {
                role: 'user',
                content: JSON.stringify(snapshot),
            },
        ];
        const estimatedInput = budget.beginRequest(reflectionMessages);
        let output = '';
        let usage;
        let usageRecorded = false;
        try {
            const completion = await this.openai.chat.completions.create({
                model,
                messages: reflectionMessages,
                temperature: 0,
                max_tokens: Math.min(1_200, limits.maxOutputTokensPerRequest),
            }, { signal });
            output = completion.choices.at(0)?.message.content ?? '';
            usage = completion.usage;
            usageRecorded = true;
            budget.finishRequest(usage, estimatedInput, output);
            return this.parseReflection(output);
        }
        finally {
            if (!usageRecorded) {
                budget.finishRequest(usage, estimatedInput, output);
            }
        }
    }
    parseReflection(raw) {
        const json = extractJsonObject(raw);
        let value;
        try {
            value = JSON.parse(json);
        }
        catch {
            throw new AgentConstraintError('INVALID_REFLECTION', '反思模型没有返回合法 JSON', true);
        }
        if (!isRecord(value)) {
            throw new AgentConstraintError('INVALID_REFLECTION', '反思结果格式错误');
        }
        const evaluation = isRecord(value.evaluation) ? value.evaluation : {};
        const correction = isRecord(value.correction) ? value.correction : {};
        const replan = isRecord(value.replan) ? value.replan : {};
        const issues = Array.isArray(evaluation.issues)
            ? evaluation.issues.filter((item) => typeof item === 'string')
            : [];
        return {
            review: asString(value.review, '未提供审查摘要'),
            evaluation: {
                passed: evaluation.passed === true,
                score: clampNumber(evaluation.score, 0, 100),
                issues,
            },
            correction: {
                required: correction.required === true,
                instruction: asString(correction.instruction),
                ...(typeof correction.revisedAnswer === 'string' &&
                    correction.revisedAnswer.length > 0
                    ? { revisedAnswer: correction.revisedAnswer }
                    : {}),
            },
            replan: {
                continue: replan.continue === true,
                instruction: asString(replan.instruction),
            },
        };
    }
    async executeToolCalls(calls, policy, signal, limits) {
        const results = [];
        for (const call of calls) {
            if (signal.aborted)
                throw signal.reason;
            try {
                const definition = this.assertToolAuthorized(call.function.name, policy);
                const parsed = JSON.parse(call.function.arguments || '{}');
                if (!isRecord(parsed)) {
                    throw new AgentConstraintError('INVALID_TOOL_ARGUMENTS', `工具 ${call.function.name} 的参数必须是对象`);
                }
                const result = await definition.execute(parsed, signal);
                const content = JSON.stringify(result);
                if (content.length > limits.maxToolResultChars) {
                    throw new AgentConstraintError('TOOL_RESULT_LIMIT', `工具 ${call.function.name} 的结果超过 ${limits.maxToolResultChars} 字符`);
                }
                results.push({ call, content, succeeded: true });
            }
            catch (error) {
                results.push({
                    call,
                    content: JSON.stringify({
                        error: error instanceof Error ? error.message : '工具执行失败',
                    }),
                    succeeded: false,
                });
            }
        }
        return results;
    }
    appendRoundMessages(messages, round, results) {
        if (round.toolCalls.length === 0) {
            if (round.content) {
                messages.push({ role: 'assistant', content: round.content });
            }
            return;
        }
        const assistantMessage = {
            role: 'assistant',
            content: round.content || null,
            tool_calls: round.toolCalls,
        };
        messages.push(assistantMessage);
        for (const result of results) {
            const toolMessage = {
                role: 'tool',
                tool_call_id: result.call.id,
                content: result.content,
            };
            messages.push(toolMessage);
        }
    }
    getAuthorizedTools(policy) {
        const permissions = new Set(policy?.permissions ?? []);
        const allowList = policy?.allowedTools
            ? new Set(policy.allowedTools)
            : undefined;
        return this.getToolDefinitions().filter((tool) => permissions.has(tool.permission) &&
            (allowList === undefined || allowList.has(tool.name)));
    }
    assertToolAuthorized(name, policy) {
        const definition = this.getToolDefinitions().find((tool) => tool.name === name);
        if (!definition) {
            throw new AgentConstraintError('UNKNOWN_TOOL', `拒绝执行未注册工具 ${name}`);
        }
        const permissions = new Set(policy?.permissions ?? []);
        const allowList = policy?.allowedTools
            ? new Set(policy.allowedTools)
            : undefined;
        if (!permissions.has(definition.permission) ||
            (allowList !== undefined && !allowList.has(name))) {
            throw new AgentConstraintError('TOOL_PERMISSION_DENIED', `无权执行工具 ${name}`);
        }
        return definition;
    }
    getToolDefinitions() {
        return [
            {
                name: 'searchWeather',
                permission: 'weather:read',
                schema: {
                    type: 'function',
                    function: {
                        name: 'searchWeather',
                        description: '查询城市天气',
                        parameters: {
                            type: 'object',
                            properties: {
                                city: {
                                    type: 'string',
                                    description: '城市名，例如北京',
                                },
                            },
                            required: ['city'],
                            additionalProperties: false,
                        },
                    },
                },
                execute: async (args, signal) => {
                    if (signal.aborted)
                        throw signal.reason;
                    const city = typeof args.city === 'string' ? args.city.trim() : '';
                    if (!city)
                        throw new Error('缺少参数 city');
                    return { city, temperature: '26°C', condition: '晴' };
                },
            },
        ];
    }
    resolveLimits(overrides) {
        return {
            timeoutMs: bounded(overrides?.timeoutMs, DEFAULT_LIMITS.timeoutMs, 1_000, HARD_LIMITS.timeoutMs),
            maxAgentRounds: bounded(overrides?.maxAgentRounds, DEFAULT_LIMITS.maxAgentRounds, 1, HARD_LIMITS.maxAgentRounds),
            maxReflectionRounds: bounded(overrides?.maxReflectionRounds, DEFAULT_LIMITS.maxReflectionRounds, 1, HARD_LIMITS.maxReflectionRounds),
            maxToolCallsPerRound: bounded(overrides?.maxToolCallsPerRound, DEFAULT_LIMITS.maxToolCallsPerRound, 1, HARD_LIMITS.maxToolCallsPerRound),
            maxModelRequests: bounded(overrides?.maxModelRequests, DEFAULT_LIMITS.maxModelRequests, 2, HARD_LIMITS.maxModelRequests),
            maxInputTokensPerRequest: bounded(overrides?.maxInputTokensPerRequest, DEFAULT_LIMITS.maxInputTokensPerRequest, 256, HARD_LIMITS.maxInputTokensPerRequest),
            maxOutputTokensPerRequest: bounded(overrides?.maxOutputTokensPerRequest, DEFAULT_LIMITS.maxOutputTokensPerRequest, 128, HARD_LIMITS.maxOutputTokensPerRequest),
            maxTotalTokens: bounded(overrides?.maxTotalTokens, DEFAULT_LIMITS.maxTotalTokens, 1_000, HARD_LIMITS.maxTotalTokens),
            maxToolResultChars: bounded(overrides?.maxToolResultChars, DEFAULT_LIMITS.maxToolResultChars, 256, HARD_LIMITS.maxToolResultChars),
        };
    }
    assertActive(signal, externalSignal, timeoutSignal) {
        if (!signal.aborted)
            return;
        if (externalSignal?.aborted) {
            throw new AgentConstraintError('ABORTED', '请求已取消');
        }
        if (timeoutSignal.aborted) {
            throw new AgentConstraintError('TIMEOUT', 'Agent 执行超时', true);
        }
        throw new AgentConstraintError('ABORTED', '请求已取消');
    }
    toErrorChunk(error, externalSignal, timeoutSignal) {
        if (externalSignal?.aborted) {
            return {
                type: 'error',
                code: 'ABORTED',
                message: '请求已取消',
                retryable: false,
            };
        }
        if (timeoutSignal.aborted) {
            return {
                type: 'error',
                code: 'TIMEOUT',
                message: 'Agent 执行超时',
                retryable: true,
            };
        }
        if (error instanceof AgentConstraintError) {
            return {
                type: 'error',
                code: error.code,
                message: error.message,
                retryable: error.retryable,
            };
        }
        return {
            type: 'error',
            code: 'AGENT_ERROR',
            message: error instanceof Error ? error.message : 'Agent 执行失败',
            retryable: false,
        };
    }
};
exports.NewToolService = NewToolService;
exports.NewToolService = NewToolService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], NewToolService);
function estimateTokens(text) {
    return Math.max(1, Math.ceil(text.length / 3));
}
function mergeUsage(accumulated, current) {
    if (!accumulated)
        return { ...current };
    return {
        prompt_tokens: accumulated.prompt_tokens + current.prompt_tokens,
        completion_tokens: accumulated.completion_tokens + current.completion_tokens,
        total_tokens: accumulated.total_tokens + current.total_tokens,
        prompt_tokens_details: current.prompt_tokens_details ?? accumulated.prompt_tokens_details,
        completion_tokens_details: current.completion_tokens_details ??
            accumulated.completion_tokens_details,
    };
}
function bounded(value, fallback, minimum, maximum) {
    if (!Number.isFinite(value))
        return fallback;
    return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}
function extractJsonObject(value) {
    const trimmed = value.trim();
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    return first >= 0 && last > first ? trimmed.slice(first, last + 1) : trimmed;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function asString(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}
function clampNumber(value, minimum, maximum) {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.min(maximum, Math.max(minimum, value))
        : minimum;
}
//# sourceMappingURL=new.toolService.js.map