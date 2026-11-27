"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIAgent = void 0;
const openai_1 = __importDefault(require("openai"));
class OpenAIAgent {
    client;
    model;
    tools;
    functions;
    maxIterations;
    maxRetries;
    stream;
    systemPrompt;
    onToken;
    constructor(options = {}) {
        const { apiKey = process.env.OPENAI_API_KEY, model = 'gpt-4o', tools = [], functions = {}, maxIterations = 5, maxRetries = 2, stream = true, systemPrompt, onToken, } = options;
        if (!apiKey) {
            throw new Error('缺少 OpenAI API Key，请设置 OPENAI_API_KEY 环境变量或传入 apiKey');
        }
        this.client = new openai_1.default({ apiKey });
        this.model = model;
        this.tools = tools;
        this.functions = functions;
        this.maxIterations = maxIterations;
        this.maxRetries = maxRetries;
        this.stream = stream;
        this.systemPrompt = systemPrompt;
        this.onToken = onToken;
    }
    async createCompletion(messages, stream) {
        let lastError;
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                return await this.client.chat.completions.create({
                    model: this.model,
                    messages,
                    tools: this.tools.length > 0 ? this.tools : undefined,
                    tool_choice: this.tools.length > 0 ? 'auto' : undefined,
                    stream,
                });
            }
            catch (err) {
                lastError = err;
                if (!this.isRetryable(err) || attempt === this.maxRetries) {
                    throw err;
                }
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise((r) => setTimeout(r, delay));
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
            if (!accumulator[idx]) {
                accumulator[idx] = { id: '', name: '', arguments: '' };
            }
            if (tc.id)
                accumulator[idx].id = tc.id;
            if (tc.function?.name)
                accumulator[idx].name += tc.function.name;
            if (tc.function?.arguments)
                accumulator[idx].arguments += tc.function.arguments;
        }
    }
    buildToolCalls(accumulator) {
        return Object.values(accumulator).map((acc) => ({
            id: acc.id,
            type: 'function',
            function: {
                name: acc.name,
                arguments: acc.arguments,
            },
        }));
    }
    async executeTool(toolCall) {
        const name = toolCall.function.name;
        const fn = this.functions[name];
        if (!fn) {
            return `错误：未找到名为 "${name}" 的工具实现`;
        }
        let args;
        try {
            args = JSON.parse(toolCall.function.arguments || '{}');
        }
        catch {
            return `错误：工具参数不是合法 JSON：${toolCall.function.arguments}`;
        }
        try {
            const result = await fn(args);
            return typeof result === 'string' ? result : JSON.stringify(result);
        }
        catch (err) {
            return `工具执行出错：${err.message}`;
        }
    }
    async run(userMessage, options = {}) {
        const { onToken = this.onToken, stream = this.stream } = options;
        const messages = [];
        if (this.systemPrompt) {
            messages.push({ role: 'system', content: this.systemPrompt });
        }
        messages.push({ role: 'user', content: userMessage });
        for (let i = 0; i < this.maxIterations; i++) {
            if (stream) {
                const response = (await this.createCompletion(messages, true));
                const accumulator = {};
                let content = '';
                for await (const chunk of response) {
                    const delta = chunk.choices[0]?.delta;
                    if (delta?.content) {
                        content += delta.content;
                        onToken?.(delta.content);
                    }
                    this.accumulateToolCalls(accumulator, delta?.tool_calls);
                }
                const toolCalls = this.buildToolCalls(accumulator);
                if (toolCalls.length === 0) {
                    return content;
                }
                messages.push({
                    role: 'assistant',
                    content: content || null,
                    tool_calls: toolCalls,
                });
                for (const toolCall of toolCalls) {
                    const result = await this.executeTool(toolCall);
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: result,
                    });
                }
            }
            else {
                const response = (await this.createCompletion(messages, false));
                const message = response.choices[0]?.message;
                if (!message?.tool_calls) {
                    const finalContent = message?.content ?? '';
                    if (finalContent)
                        onToken?.(finalContent);
                    return finalContent;
                }
                messages.push({
                    role: 'assistant',
                    content: message.content || null,
                    tool_calls: message.tool_calls,
                });
                for (const toolCall of message.tool_calls) {
                    const result = await this.executeTool(toolCall);
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: result,
                    });
                }
            }
        }
        throw new Error(`达到最大循环次数（${this.maxIterations}），仍未获得最终答案`);
    }
}
exports.OpenAIAgent = OpenAIAgent;
//# sourceMappingURL=OpenAIAgent.service.js.map