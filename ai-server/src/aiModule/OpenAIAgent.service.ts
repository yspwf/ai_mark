import OpenAI from 'openai';

// ============ 类型定义 ============
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

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

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// 工具实现函数：接收解析后的参数对象，返回可序列化的结果
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

// 流式工具调用累积器
interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

// ============ 主类 ============
class OpenAIAgent {
  private client: OpenAI;
  private model: string;
  private tools: Tool[];
  private functions: FunctionsMap;
  private maxIterations: number;
  private maxRetries: number;
  private stream: boolean;
  private systemPrompt?: string;
  private onToken?: (token: string) => void;

  constructor(options: AgentOptions = {}) {
    const {
      apiKey = process.env.OPENAI_API_KEY,
      model = 'gpt-4o',
      tools = [],
      functions = {},
      maxIterations = 5,
      maxRetries = 2,
      stream = true,
      systemPrompt,
      onToken,
    } = options;

    if (!apiKey) {
      throw new Error('缺少 OpenAI API Key，请设置 OPENAI_API_KEY 环境变量或传入 apiKey');
    }

    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.tools = tools;
    this.functions = functions;
    this.maxIterations = maxIterations;
    this.maxRetries = maxRetries;
    this.stream = stream;
    this.systemPrompt = systemPrompt;
    this.onToken = onToken;
  }

  // ============ 带重试的请求封装 ============
  private async createCompletion(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    stream: boolean
  ): Promise<OpenAI.Chat.Completions.ChatCompletion | AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.client.chat.completions.create({
          model: this.model,
          messages,
          tools: this.tools.length > 0 ? this.tools : undefined,
          tool_choice: this.tools.length > 0 ? 'auto' : undefined,
          stream,
        });
      } catch (err) {
        lastError = err;
        if (!this.isRetryable(err) || attempt === this.maxRetries) {
          throw err;
        }
        const delay = Math.pow(2, attempt) * 1000; // 指数退避
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastError;
  }

  private isRetryable(err: unknown): boolean {
    const status = (err as { status?: number })?.status;
    const code = (err as { code?: string })?.code;
    const name = (err as { name?: string })?.name;

    return (
      status === 429 ||
      (typeof status === 'number' && status >= 500 && status < 600) ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      name === 'APIConnectionError' ||
      name === 'APIConnectionTimeoutError'
    );
  }

  // ============ 流式工具调用拼接 ============
  private accumulateToolCalls(
    accumulator: Record<number, AccumulatedToolCall>,
    deltaToolCalls?: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall[]
  ): void {
    if (!deltaToolCalls) return;

    for (const tc of deltaToolCalls) {
      const idx = tc.index;
      if (!accumulator[idx]) {
        accumulator[idx] = { id: '', name: '', arguments: '' };
      }
      if (tc.id) accumulator[idx].id = tc.id;
      if (tc.function?.name) accumulator[idx].name += tc.function.name;
      if (tc.function?.arguments) accumulator[idx].arguments += tc.function.arguments;
    }
  }

  private buildToolCalls(accumulator: Record<number, AccumulatedToolCall>): ToolCall[] {
    return Object.values(accumulator).map((acc) => ({
      id: acc.id,
      type: 'function' as const,
      function: {
        name: acc.name,
        arguments: acc.arguments,
      },
    }));
  }

  // ============ 执行单个工具 ============
  private async executeTool(toolCall: ToolCall): Promise<string> {
    const name = toolCall.function.name;
    const fn = this.functions[name];

    if (!fn) {
      return `错误：未找到名为 "${name}" 的工具实现`;
    }

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
    } catch {
      return `错误：工具参数不是合法 JSON：${toolCall.function.arguments}`;
    }

    try {
      const result = await fn(args);
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (err) {
      return `工具执行出错：${(err as Error).message}`;
    }
  }

  // ============ 主运行方法 ============
  async run(userMessage: string, options: RunOptions = {}): Promise<string> {
    const { onToken = this.onToken, stream = this.stream } = options;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    if (this.systemPrompt) {
      messages.push({ role: 'system', content: this.systemPrompt });
    }
    messages.push({ role: 'user', content: userMessage });

    for (let i = 0; i < this.maxIterations; i++) {
      if (stream) {
        // -------- 流式模式 --------
        const response = (await this.createCompletion(messages, true)) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

        const accumulator: Record<number, AccumulatedToolCall> = {};
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
          return content; // 最终回答
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
      } else {
        // -------- 非流式模式 --------
        const response = (await this.createCompletion(messages, false)) as OpenAI.Chat.Completions.ChatCompletion;
        const message = response.choices[0]?.message;

        if (!message?.tool_calls) {
          const finalContent = message?.content ?? '';
          if (finalContent) onToken?.(finalContent);
          return finalContent;
        }

        messages.push({
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.tool_calls as ToolCall[],
        });

        for (const toolCall of message.tool_calls as ToolCall[]) {
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

export { OpenAIAgent };
export type { Tool, ToolFunction, ToolHandler, FunctionsMap, AgentOptions, JsonValue };
