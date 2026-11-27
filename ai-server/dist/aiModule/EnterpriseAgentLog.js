"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnterpriseAgent = void 0;
const openai_1 = __importDefault(require("openai"));
class EnterpriseAgent {
    client;
    model;
    tools;
    functions;
    stream;
    systemPrompt;
    onToken;
    onToolCall;
    maxIterations;
    maxToolCallsPerRun;
    llmTimeoutMs;
    toolTimeoutMs;
    totalTimeoutMs;
    rules;
    maxBudgetUsd;
    maxTokensPerRequest;
    enableReflection;
    reflectionModel;
    reflectionInterval;
    cost = {
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        estimatedCostUsd: 0,
    };
    constructor(options = {}) {
        const { apiKey = [REDACTED], _API_KEY, model = 'gpt-4o', tools = [], functions = {}, stream = true, systemPrompt, onToken, onToolCall, maxIterations = 8, maxToolCallsPerRun = 20, llmTimeoutMs = 30_000, toolTimeoutMs = 10_000, totalTimeoutMs = 120_000, rules = [], maxBudgetUsd = 1.0, maxTokensPerRequest = 4000, enableReflection = true, reflectionModel, reflectionInterval = 1, } = options;
        if (!apiKey)
            throw new Error('缺少 OpenAI API Key');
        this.client = new openai_1.default({ apiKey, timeout: llmTimeoutMs });
        this.model = model;
        this.tools = tools;
        this.functions = functions;
        this.stream = stream;
        this.systemPrompt = systemPrompt;
        this.onToken = onToken;
        this.onToolCall = onToolCall;
        this.maxIterations = maxIterations;
        this.maxToolCallsPerRun = maxToolCallsPerRun;
        this.llmTimeoutMs = llmTimeoutMs;
        this.toolTimeoutMs = toolTimeoutMs;
        this.totalTimeoutMs = totalTimeoutMs;
        this.rules = rules;
        this.maxBudgetUsd = maxBudgetUsd;
        this.maxTokensPerRequest = maxTokensPerRequest;
        this.enableReflection = enableReflection;
        this.reflectionModel = reflectionModel ?? model;
        this.reflectionInterval = reflectionInterval;
    }
    trackUsage(usage) {
        if (!usage)
            return;
        this.cost.promptTokens += usage.prompt_tokens ?? 0;
        this.cost.completionTokens += usage.completion_tokens ?? 0;
        this.cost.totalTokens += usage.total_tokens ?? 0;
        const inputCost = (usage.prompt_tokens ?? 0) * (2.5 / 1_000_000);
        const outputCost = (usage.completion_tokens ?? 0) * (10 / 1_000_000);
        this.cost.estimatedCostUsd += inputCost + outputCost;
    }
    checkBudget() {
        if (this.cost.estimatedCostUsd >= this.maxBudgetUsd) {
            throw new Error(`成本熔断：已超预算上限 $${this.maxBudgetUsd}（当前 $${this.cost.estimatedCostUsd.toFixed(4)}）`);
        }
    }
    checkPermission(toolName, args) {
        for (const rule of this.rules) {
            const toolMatch = typeof rule.tool === 'string' ? rule.tool === toolName : rule.tool.test(toolName);
            if (!toolMatch)
                continue;
            if (rule.param) {
                const value = args[rule.param];
                if (value === undefined)
                    continue;
                const valueStr = String(value);
                const paramMatch = rule.paramPattern
                    ? typeof rule.paramPattern === 'string'
                        ? rule.paramPattern === valueStr
                        : rule.paramPattern.test(valueStr)
                    : true;
                if (!paramMatch)
                    continue;
            }
            if (rule.effect === 'deny') {
                return { allowed: false, reason: rule.reason ?? `工具 ${toolName} 被权限规则拒绝` };
            }
        }
        return { allowed: true };
    }
    async withTimeout(promise, ms, label) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
        });
        try {
            return await Promise.race([promise, timeout]);
        }
        finally {
            clearTimeout(timer);
        }
    }
    async createCompletion(messages, stream, model) {
        let lastError;
        const maxRetries = 2;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await this.withTimeout(this.client.chat.completions.create({
                    model: model ?? this.model,
                    messages,
                    tools: this.tools.length > 0 ? this.tools : undefined,
                    tool_choice: this.tools.length > 0 ? 'auto' : undefined,
                    stream,
                    max_tokens: this.maxTokensPerRequest,
                }), this.llmTimeoutMs, 'LLM 请求');
                if (!stream) {
                    this.trackUsage(response.usage);
                    this.checkBudget();
                }
                return response;
            }
            catch (err) {
                lastError = err;
                if (!this.isRetryable(err) || attempt === maxRetries)
                    throw err;
                await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
            }
        }
        throw lastError;
    }
    isRetryable(err) {
        const status = err?.status;
        const code = err?.code;
        const name = err?.name;
        return (status === 429 ||
            (typeof status === 'number' && status >= 500 && status < 600) ||
            code === 'ECONNRESET' ||
            code === 'ETIMEDOUT' ||
            name === 'APIConnectionError' ||
            name === 'APIConnectionTimeoutError');
    }
    accumulateToolCalls(accumulator, deltaToolCalls) {
        if (!deltaToolCalls)
            return;
        for (const tc of deltaToolCalls) {
            const idx = tc.index;
            const isNew = !accumulator[idx];
            if (isNew) {
                accumulator[idx] = { id: '', name: '', arguments: '' };
                this.onToolCall?.({ type: 'start', index: idx });
            }
            if (tc.id)
                accumulator[idx].id = tc.id;
            if (tc.function?.name) {
                accumulator[idx].name += tc.function.name;
                this.onToolCall?.({ type: 'delta', index: idx, name: tc.function.name });
            }
            if (tc.function?.arguments) {
                accumulator[idx].arguments += tc.function.arguments;
                this.onToolCall?.({ type: 'delta', index: idx, argsChunk: tc.function.arguments });
            }
        }
    }
    buildToolCalls(accumulator) {
        return Object.values(accumulator).map((acc) => {
            const toolCall = {
                id: acc.id,
                type: 'function',
                function: { name: acc.name, arguments: acc.arguments },
            };
            this.onToolCall?.({
                type: 'complete',
                index: Object.keys(accumulator).indexOf(acc.id) === -1 ? 0 : 0,
                name: acc.name,
                fullArgs: acc.arguments,
            });
            return toolCall;
        });
    }
    async executeTool(toolCall, toolCallCount) {
        const start = Date.now();
        const name = toolCall.function.name;
        if (toolCallCount >= this.maxToolCallsPerRun) {
            const result = {
                success: false,
                output: `轮次熔断：已达到最大工具调用次数 ${this.maxToolCallsPerRun}`,
                durationMs: 0,
                denied: true,
                reason: 'max_tool_calls_exceeded',
            };
            this.onToolCall?.({ type: 'executed', name, success: false, durationMs: 0, output: result.output });
            return result;
        }
        let args;
        try {
            args = JSON.parse(toolCall.function.arguments || '{}');
        }
        catch {
            const result = {
                success: false,
                output: '错误：工具参数不是合法 JSON',
                durationMs: Date.now() - start,
            };
            this.onToolCall?.({ type: 'executed', name, success: false, durationMs: result.durationMs, output: result.output });
            return result;
        }
        const permission = this.checkPermission(name, args);
        if (!permission.allowed) {
            const result = {
                success: false,
                output: `权限拒绝：${permission.reason}`,
                durationMs: Date.now() - start,
                denied: true,
                reason: permission.reason,
            };
            this.onToolCall?.({ type: 'executed', name, success: false, durationMs: result.durationMs, output: result.output });
            return result;
        }
        const fn = this.functions[name];
        if (!fn) {
            const result = {
                success: false,
                output: `错误：未找到工具 "${name}" 的实现`,
                durationMs: Date.now() - start,
            };
            this.onToolCall?.({ type: 'executed', name, success: false, durationMs: result.durationMs, output: result.output });
            return result;
        }
        try {
            const output = await this.withTimeout(Promise.resolve(fn(args)), this.toolTimeoutMs, `工具 ${name}`);
            const outputStr = typeof output === 'string' ? output : JSON.stringify(output);
            const result = {
                success: true,
                output: outputStr,
                durationMs: Date.now() - start,
            };
            this.onToolCall?.({ type: 'executed', name, success: true, durationMs: result.durationMs, output: outputStr });
            return result;
        }
        catch (err) {
            const result = {
                success: false,
                output: `工具执行出错：${err.message}`,
                durationMs: Date.now() - start,
            };
            this.onToolCall?.({ type: 'executed', name, success: false, durationMs: result.durationMs, output: result.output });
            return result;
        }
    }
    async reflect(userMessage, messages, toolResults) {
        const reflectionPrompt = [
            {
                role: 'system',
                content: `你是 Agent 执行反思器。请评审以下执行过程，输出严格 JSON，格式：
{
  "verdict": "continue" | "correct" | "replan" | "stop",
  "issues": ["发现的问题"],
  "corrections": ["修正建议"],
  "replanStrategy": "重新规划的策略（replan 时必填）",
  "confidence": 0.0-1.0
}
判定规则：
- continue：执行正确，继续下一步
- correct：有小偏差，可局部修正（如参数错误、结果格式问题）
- replan：方向错误，需要重新规划
- stop：任务已完成或无法继续`,
            },
            {
                role: 'user',
                content: `用户任务：${userMessage}\n\n当前执行轨迹：\n${JSON.stringify({ messages: messages.slice(-6), toolResults: toolResults.slice(-4) }, null, 2)}`,
            },
        ];
        try {
            const response = (await this.createCompletion(reflectionPrompt, false, this.reflectionModel));
            const content = response.choices[0]?.message?.content ?? '';
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return { verdict: 'continue', issues: ['反思输出无法解析'], corrections: [], confidence: 0.5 };
            }
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                verdict: parsed.verdict,
                issues: parsed.issues ?? [],
                corrections: parsed.corrections ?? [],
                replanStrategy: parsed.replanStrategy,
                confidence: parsed.confidence ?? 0.5,
            };
        }
        catch {
            return { verdict: 'continue', issues: ['反思过程异常，默认继续'], corrections: [], confidence: 0.3 };
        }
    }
    async run(userMessage, options = {}) {
        const { onToken = this.onToken, stream = this.stream } = options;
        return this.withTimeout(this._runInternal(userMessage, { onToken, stream }), this.totalTimeoutMs, '整个 Agent 运行');
    }
    async _runInternal(userMessage, options) {
        const { onToken, stream } = options;
        const messages = [];
        if (this.systemPrompt) {
            messages.push({ role: 'system', content: this.systemPrompt });
        }
        messages.push({ role: 'user', content: userMessage });
        let toolCallCount = 0;
        const allToolResults = [];
        let lastReflection = null;
        for (let i = 0; i < this.maxIterations; i++) {
            if (i >= this.maxIterations - 1) {
                messages.push({
                    role: 'system',
                    content: '已达到最大迭代次数，请基于已有信息直接给出最终回答，不要再调用工具。',
                });
            }
            let content = '';
            let toolCalls = [];
            if (stream) {
                const response = (await this.createCompletion(messages, true));
                const accumulator = {};
                for await (const chunk of response) {
                    const delta = chunk.choices[0]?.delta;
                    if (delta?.content) {
                        content += delta.content;
                        onToken?.(delta.content);
                    }
                    this.accumulateToolCalls(accumulator, delta?.tool_calls);
                }
                toolCalls = this.buildToolCalls(accumulator);
            }
            else {
                const response = (await this.createCompletion(messages, false));
                const message = response.choices[0]?.message;
                content = message?.content ?? '';
                toolCalls = message?.tool_calls ?? [];
                if (content)
                    onToken?.(content);
            }
            if (toolCalls.length === 0) {
                if (allToolResults.length === 0) {
                    return content;
                }
                if (this.enableReflection) {
                    const reflection = await this.reflect(userMessage, messages, allToolResults);
                    lastReflection = reflection;
                }
                return content;
            }
            messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });
            const roundResults = [];
            const results = await Promise.all(toolCalls.map((toolCall) => {
                toolCallCount++;
                return this.executeTool(toolCall, toolCallCount);
            }));
            toolCalls.forEach((toolCall, idx) => {
                const result = results[idx];
                roundResults.push(result);
                allToolResults.push(result);
                messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: result.output,
                });
            });
            if (this.enableReflection && (i + 1) % this.reflectionInterval === 0) {
                const reflection = await this.reflect(userMessage, messages, roundResults);
                lastReflection = reflection;
                switch (reflection.verdict) {
                    case 'stop':
                        messages.push({
                            role: 'system',
                            content: '反思器判定任务已完成，请基于已有信息直接给出最终回答，不要再调用工具。',
                        });
                        break;
                    case 'correct':
                        messages.push({
                            role: 'system',
                            content: `反思器发现以下问题，请修正后继续：
问题：${reflection.issues.join('；')}
修正建议：${reflection.corrections.join('；')}`,
                        });
                        break;
                    case 'replan':
                        messages.push({
                            role: 'system',
                            content: `反思器判定当前方向有误，请按以下策略重新规划执行：
${reflection.replanStrategy ?? '重新分析任务目标，调整工具调用策略'}`,
                        });
                        break;
                    case 'continue':
                    default:
                        break;
                }
                if (reflection.confidence < 0.3 && i >= 2) {
                    messages.push({
                        role: 'system',
                        content: '反思置信度过低，请基于已有信息直接给出最终回答，不要再调用工具。',
                    });
                }
            }
        }
        const finalResponse = (await this.createCompletion([
            ...messages,
            {
                role: 'system',
                content: '请基于以上全部信息，直接给出最终回答，不要再调用任何工具。',
            },
        ], false));
        const finalContent = finalResponse.choices[0]?.message?.content ?? '';
        if (finalContent)
            this.onToken?.(finalContent);
        return finalContent;
    }
    getCost() {
        return { ...this.cost };
    }
}
exports.EnterpriseAgent = EnterpriseAgent;
//# sourceMappingURL=EnterpriseAgentLog.js.map