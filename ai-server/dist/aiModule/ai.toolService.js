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
exports.AiToolService = void 0;
const common_1 = require("@nestjs/common");
const openai_1 = __importDefault(require("openai"));
const MAX_TOOL_ROUNDS = 5;
let AiToolService = class AiToolService {
    openai;
    config;
    constructor() {
        this.openai = new openai_1.default({
            apiKey: 'sk-aaqvxuzrclquxrfjnufjcbwrudqotpgmvwuirnazzsmmeudw',
            baseURL: 'https://api.siliconflow.cn/v1',
            timeout: 120000
        });
        this.config = {
            timeoutMs: 120000,
            maxRetries: 2,
            maxInputTokens: 8000,
            totalTokenCircuitBreaker: 500000,
            baseRetryDelayMs: 1000,
            model: 'zai-org/GLM-5.3-Flash',
        };
    }
    async *streamChat(messages, options = {}) {
        const startTime = performance.now();
        const { signal, model = this.config.model } = options;
        const workingMessages = [...messages];
        let totalUsage;
        let finalFinishReason = null;
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
            let stream;
            try {
                stream = await this.openai.chat.completions.create({
                    model,
                    messages: workingMessages,
                    stream: true,
                    stream_options: { include_usage: true },
                    tools: this.buildTools(),
                    tool_choice: 'auto',
                    temperature: 0.7,
                    max_tokens: 1000,
                }, { signal });
            }
            catch (error) {
                if (signal?.aborted) {
                    yield { type: 'error', code: 'ABORTED', message: '请求已取消', retryable: false };
                    return;
                }
                yield {
                    type: 'error',
                    code: 'UPSTREAM_ERROR',
                    message: error instanceof Error ? error.message : '请求模型失败',
                    retryable: true,
                };
                return;
            }
            const toolCallBuffer = new Map();
            let roundFinishReason = null;
            try {
                for await (const chunk of stream) {
                    if (signal?.aborted) {
                        yield { type: 'error', code: 'ABORTED', message: '请求已取消', retryable: false };
                        return;
                    }
                    if (chunk.usage)
                        totalUsage = this.mergeUsage(totalUsage, chunk.usage);
                    const choice = chunk.choices.at(0);
                    if (!choice)
                        continue;
                    const content = choice.delta?.content;
                    const reasoning = chunk.choices[0]?.delta?.refusal || "";
                    if (reasoning)
                        console.log("[推理过程]:", reasoning);
                    if (content)
                        console.log("[回答]:", content);
                    if (content)
                        yield { type: 'content', content };
                    if (choice.delta.tool_calls) {
                        for (const tc of choice.delta.tool_calls) {
                            const idx = tc.index;
                            if (!toolCallBuffer.has(idx)) {
                                toolCallBuffer.set(idx, { arguments: '' });
                            }
                            const pending = toolCallBuffer.get(idx);
                            if (tc.id)
                                pending.id = tc.id;
                            if (tc.function?.name)
                                pending.name = tc.function.name;
                            if (tc.function?.arguments)
                                pending.arguments += tc.function.arguments;
                        }
                    }
                    if (choice.finish_reason)
                        roundFinishReason = choice.finish_reason;
                }
            }
            catch (error) {
                if (signal?.aborted) {
                    yield { type: 'error', code: 'ABORTED', message: '请求已取消', retryable: false };
                    return;
                }
                yield {
                    type: 'error',
                    code: 'UPSTREAM_ERROR',
                    message: error instanceof Error ? error.message : '请求模型失败',
                    retryable: true,
                };
                return;
            }
            if (roundFinishReason === 'length' && toolCallBuffer.size > 0) {
                yield {
                    type: 'error',
                    code: 'TOOL_CALL_TRUNCATED',
                    message: '工具参数被截断，请增大 max_tokens',
                    retryable: false,
                };
                return;
            }
            if (roundFinishReason !== 'tool_calls' || toolCallBuffer.size === 0) {
                finalFinishReason = roundFinishReason;
                break;
            }
            const toolCalls = [...toolCallBuffer.entries()]
                .sort(([a], [b]) => a - b)
                .map(([, p], i) => {
                if (!p.id || !p.name) {
                    throw new Error(`工具调用 #${i} 缺少 id 或 name`);
                }
                return {
                    id: p.id,
                    type: 'function',
                    function: { name: p.name, arguments: p.arguments },
                };
            });
            const assistantMsg = {
                role: 'assistant',
                content: null,
                tool_calls: toolCalls,
            };
            workingMessages.push(assistantMsg);
            for (const call of toolCalls) {
                let resultContent;
                try {
                    const args = JSON.parse(call.function.arguments || '{}');
                    const result = await this.executeTool(call.function.name, args);
                    resultContent = JSON.stringify(result);
                }
                catch (err) {
                    resultContent = JSON.stringify({
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
                const toolMsg = {
                    role: 'tool',
                    tool_call_id: call.id,
                    content: resultContent,
                };
                workingMessages.push(toolMsg);
            }
            if (round === MAX_TOOL_ROUNDS) {
                yield {
                    type: 'error',
                    code: 'TOOL_LOOP_LIMIT',
                    message: `工具调用超过 ${MAX_TOOL_ROUNDS} 轮，已中止`,
                    retryable: false,
                };
                return;
            }
        }
        yield {
            type: 'done',
            finishReason: finalFinishReason,
            usage: totalUsage,
            durationMs: performance.now() - startTime,
        };
    }
    buildTools() {
        return [
            {
                type: 'function',
                function: {
                    name: 'searchWeather',
                    description: '查询城市天气',
                    parameters: {
                        type: 'object',
                        properties: {
                            city: { type: 'string', description: '城市名，如：北京' },
                        },
                        required: ['city'],
                    },
                },
            },
        ];
    }
    async executeTool(name, args) {
        switch (name) {
            case 'searchWeather': {
                const city = typeof args.city === 'string' ? args.city : '';
                if (!city)
                    throw new Error('缺少参数 city');
                return this.fakeWeather(city);
            }
            default:
                throw new Error(`未知工具: ${name}`);
        }
    }
    async fakeWeather(city) {
        return { city, temp: '26°C', condition: '晴' };
    }
    mergeUsage(acc, cur) {
        if (!acc)
            return { ...cur };
        return {
            prompt_tokens: acc.prompt_tokens + cur.prompt_tokens,
            completion_tokens: acc.completion_tokens + cur.completion_tokens,
            total_tokens: acc.total_tokens + cur.total_tokens,
            prompt_tokens_details: cur.prompt_tokens_details ?? acc.prompt_tokens_details,
            completion_tokens_details: cur.completion_tokens_details ?? acc.completion_tokens_details,
        };
    }
};
exports.AiToolService = AiToolService;
exports.AiToolService = AiToolService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], AiToolService);
//# sourceMappingURL=ai.toolService.js.map