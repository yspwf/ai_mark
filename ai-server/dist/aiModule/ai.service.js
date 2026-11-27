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
exports.AiService = void 0;
const common_1 = require("@nestjs/common");
const openai_1 = __importDefault(require("openai"));
let AiService = class AiService {
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
    async chatBase() {
        try {
            const res = await this.openai.chat.completions.create({
                model: this.config.model,
                messages: [
                    { role: 'system', content: '你是一个专业的技术助手，回答简洁、准确、不啰嗦' },
                    { role: 'user', content: '用 Node.js 调用 OpenAI 最好的参数配置是什么？' },
                ],
                temperature: 0.7,
                max_tokens: 1024,
                top_p: 1,
                frequency_penalty: 0,
                presence_penalty: 0,
                stream: true,
            });
            for await (const chunk of res) {
                const content = chunk.choices[0]?.delta?.content || '';
                process.stdout.write(content);
            }
        }
        catch (err) {
            if (err instanceof openai_1.default.APIError) {
                console.error('状态码:', err.status);
                console.error('错误信息:', err.error);
            }
            if (err instanceof openai_1.default.AuthenticationError)
                console.log('密钥错误');
            if (err instanceof openai_1.default.RateLimitError)
                console.log('限流了');
            if (err instanceof openai_1.default.APIConnectionTimeoutError)
                console.log('请求超时');
            throw err;
        }
    }
    async fakeWeather(city) {
        return {
            city,
            temp: "26°C",
            condition: "晴"
        };
    }
    async *streamChat(messages, options = {}) {
        const startTime = performance.now();
        const { signal, model } = options ?? {};
        let stream;
        try {
            stream = await this.openai.chat.completions.create({
                model: this.config.model,
                messages,
                stream: true,
                stream_options: { include_usage: true },
                tools: [
                    {
                        type: "function",
                        function: {
                            name: "searchWeather",
                            description: "查询城市天气",
                            parameters: {
                                type: "object",
                                properties: {
                                    city: { type: "string" },
                                },
                                required: ["city"],
                            },
                        },
                    }
                ],
                tool_choice: 'auto',
            }, { signal });
        }
        catch (error) {
            if (signal?.aborted) {
                yield { type: "error", code: 'ABORTED', message: '请求已取消', retryable: false };
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
        let finishReason = null;
        let usage;
        try {
            const toolCallBuffer = new Map();
            for await (const chunk of stream) {
                if (signal?.aborted)
                    return;
                if (chunk.usage)
                    usage = chunk.usage;
                const choice = chunk.choices.at(0);
                if (!choice)
                    continue;
                if (choice.finish_reason)
                    finishReason = choice.finish_reason;
                const content = choice.delta?.content;
                if (content) {
                    yield { type: 'content', content };
                }
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
        yield {
            type: 'done',
            finishReason,
            usage,
            durationMs: performance.now() - startTime
        };
    }
};
exports.AiService = AiService;
exports.AiService = AiService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], AiService);
//# sourceMappingURL=ai.service.js.map