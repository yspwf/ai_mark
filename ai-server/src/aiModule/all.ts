import OpenAI from 'openai';
import 'dotenv/config';

// ==================== 基础类型 ====================
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
  function: { name: string; arguments: string };
}

// 工具返回值类型（含多模态）
type ToolReturnValue =
  | JsonValue
  | { imageUrl?: string; imageBase64?: string; images?: Array<{ imageUrl?: string; imageBase64?: string }> };

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolReturnValue> | ToolReturnValue;
type FunctionsMap = Record<string, ToolHandler>;

// ==================== 权限规则 ====================
type RuleEffect = 'allow' | 'deny';

interface PermissionRule {
  tool: string | RegExp;
  param?: string;
  paramPattern?: string | RegExp;
  effect: RuleEffect;
  reason?: string;
}

// ==================== 四重约束配置 ====================
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

// ==================== Reflection 四步闭环 ====================
interface ReflectionResult {
  verdict: 'continue' | 'correct' | 'replan' | 'stop';
  issues: string[];
  corrections: string[];
  replanStrategy?: string;
  confidence: number;
}

// ==================== 工具调用日志事件 ====================
type ToolCallEvent =
  | { type: 'start'; index: number }
  | { type: 'delta'; index: number; name?: string; argsChunk?: string }
  | { type: 'complete'; index: number; name: string; fullArgs: string }
  | { type: 'executed'; name: string; success: boolean; durationMs: number; output: string };

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
  clearHistory?: boolean;
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface ToolExecutionResult {
  success: boolean;
  output: string;
  multimodalContent?: OpenAI.Chat.Completions.ChatCompletionContentPart[];
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

// ==================== 主类 ====================
class EnterpriseAgent {
  private client: OpenAI;
  private model: string;
  private tools: Tool[];
  private functions: FunctionsMap;
  private stream: boolean;
  private systemPrompt?: string;
  private onToken?: (token: string) => void;
  private onToolCall?: (event: ToolCallEvent) => void;

  private maxIterations: number;
  private maxToolCallsPerRun: number;
  private llmTimeoutMs: number;
  private toolTimeoutMs: number;
  private totalTimeoutMs: number;
  private rules: PermissionRule[];
  private maxBudgetUsd: number;
  private maxTokensPerRequest: number;

  private enableReflection: boolean;
  private reflectionModel: string;
  private reflectionInterval: number;

  private cost: CostTracker = {
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0,
  };

  // 多轮对话历史
  private history: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  constructor(options: AgentOptions = {}) {
    const {
      apiKey = [REDACTED].OPENAI_API_KEY,
      model = 'gpt-4o',
      tools = [],
      functions = {},
      stream = true,
      systemPrompt,
      onToken,
      onToolCall,
      maxIterations = 8,
      maxToolCallsPerRun = 20,
      llmTimeoutMs = 30_000,
      toolTimeoutMs = 10_000,
      totalTimeoutMs = 120_000,
      rules = [],
      maxBudgetUsd = 1.0,
      maxTokensPerRequest = 4000,
      enableReflection = true,
      reflectionModel,
      reflectionInterval = 1,
    } = options;

    if (!apiKey) throw new Error('缺少 OpenAI API Key');

    this.client = new OpenAI({ apiKey, timeout: llmTimeoutMs });
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

  // ==================== 成本追踪 ====================
  private trackUsage(usage?: OpenAI.Completions.CompletionUsage): void {
    if (!usage) return;
    this.cost.promptTokens += usage.prompt_tokens ?? 0;
    this.cost.completionTokens += usage.completion_tokens ?? 0;
    this.cost.totalTokens += usage.total_tokens ?? 0;

    const inputCost = (usage.prompt_tokens ?? 0) * (2.5 / 1_000_000);
    const outputCost = (usage.completion_tokens ?? 0) * (10 / 1_000_000);
    this.cost.estimatedCostUsd += inputCost + outputCost;
  }

  private checkBudget(): void {
    if (this.cost.estimatedCostUsd >= this.maxBudgetUsd) {
      throw new Error(
        `成本熔断：已超预算上限 $${this.maxBudgetUsd}（当前 $${this.cost.estimatedCostUsd.toFixed(4)}）`
      );
    }
  }

  // ==================== 权限校验 ====================
  private checkPermission(toolName: string, args: Record<string, unknown>): { allowed: boolean; reason?: string } {
    for (const rule of this.rules) {
      const toolMatch = typeof rule.tool === 'string' ? rule.tool === toolName : rule.tool.test(toolName);
      if (!toolMatch) continue;

      if (rule.param) {
        const value = args[rule.param];
        if (value === undefined) continue;
        const valueStr = String(value);
        const paramMatch = rule.paramPattern
          ? typeof rule.paramPattern === 'string'
            ? rule.paramPattern === valueStr
            : rule.paramPattern.test(valueStr)
          : true;
        if (!paramMatch) continue;
      }

      if (rule.effect === 'deny') {
        return { allowed: false, reason: rule.reason ?? `工具 ${toolName} 被权限规则拒绝` };
      }
    }
    return { allowed: true };
  }

  // ==================== 超时控制 ====================
  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  // ==================== 带重试的请求 ====================
  private async createCompletion(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    stream: boolean,
    model?: string
  ): Promise<
    | OpenAI.Chat.Completions.ChatCompletion
    | AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
  > {
    let lastError: unknown;
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.withTimeout(
          this.client.chat.completions.create({
            model: model ?? this.model,
            messages,
            tools: this.tools.length > 0 ? this.tools : undefined,
            tool_choice: this.tools.length > 0 ? 'auto' : undefined,
            stream,
            max_tokens: this.maxTokensPerRequest,
          }),
          this.llmTimeoutMs,
          'LLM 请求'
        );

        if (!stream) {
          this.trackUsage((response as OpenAI.Chat.Completions.ChatCompletion).usage);
          this.checkBudget();
        }
        return response;
      } catch (err) {
        lastError = err;
        if (!this.isRetryable(err) || attempt === maxRetries) throw err;
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
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

  // ==================== 流式拼接（含日志）====================
  private accumulateToolCalls(
    accumulator: Record<number, AccumulatedToolCall>,
    deltaToolCalls?: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall[]
  ): void {
    if (!deltaToolCalls) return;

    for (const tc of deltaToolCalls) {
      const idx = tc.index;
      const isNew = !accumulator[idx];

      if (isNew) {
        accumulator[idx] = { id: '', name: '', arguments: '' };
        this.onToolCall?.({ type: 'start', index: idx });
      }

      if (tc.id) accumulator[idx].id = tc.id;

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

  private buildToolCalls(accumulator: Record<number, AccumulatedToolCall>): ToolCall[] {
    const entries = Object.entries(accumulator);
    return entries.map(([key, acc]) => {
      const toolCall: ToolCall = {
        id: acc.id,
        type: 'function' as const,
        function: { name: acc.name, arguments: acc.arguments },
      };
      this.onToolCall?.({
        type: 'complete',
        index: Number(key),
        name: acc.name,
        fullArgs: acc.arguments,
      });
      return toolCall;
    });
  }

  // ==================== 多模态结果判断 ====================
  private isMultimodalResult(result: unknown): result is {
    imageUrl?: string;
    imageBase64?: string;
    images?: Array<{ imageUrl?: string; imageBase64?: string }>;
  } {
    if (typeof result !== 'object' || result === null) return false;
    const obj = result as Record<string, unknown>;
    return 'imageUrl' in obj || 'imageBase64' in obj || 'images' in obj;
  }

  private toMultimodalContent(result: {
    imageUrl?: string;
    imageBase64?: string;
    images?: Array<{ imageUrl?: string; imageBase64?: string }>;
  }): OpenAI.Chat.Completions.ChatCompletionContentPart[] {
    const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

    const images: Array<{ imageUrl?: string; imageBase64?: string }> = [];
    if (result.imageUrl) images.push({ imageUrl: result.imageUrl });
    if (result.imageBase64) images.push({ imageBase64: result.imageBase64 });
    if (result.images) images.push(...result.images);

    for (const img of images) {
      if (img.imageUrl) {
        parts.push({ type: 'image_url', image_url: { url: img.imageUrl } });
      }
      if (img.imageBase64) {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${img.imageBase64}` },
        });
      }
    }
    return parts;
  }

  // ==================== 工具执行（权限 + 超时 + 熔断 + 日志 + 多模态）====================
  private async executeTool(toolCall: ToolCall, toolCallCount: number): Promise<ToolExecutionResult> {
    const start = Date.now();
    const name = toolCall.function.name;

    if (toolCallCount >= this.maxToolCallsPerRun) {
      const result: ToolExecutionResult = {
        success: false,
        output: `轮次熔断：已达到最大工具调用次数 ${this.maxToolCallsPerRun}`,
        durationMs: 0,
        denied: true,
        reason: 'max_tool_calls_exceeded',
      };
      this.onToolCall?.({ type: 'executed', name, success: false, durationMs: 0, output: result.output });
      return result;
    }

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
    } catch {
      const result: ToolExecutionResult = {
        success: false,
        output: '错误：工具参数不是合法 JSON',
        durationMs: Date.now() - start,
      };
      this.onToolCall?.({ type: 'executed', name, success: false, durationMs: result.durationMs, output: result.output });
      return result;
    }

    const permission = this.checkPermission(name, args);
    if (!permission.allowed) {
      const result: ToolExecutionResult = {
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
      const result: ToolExecutionResult = {
        success: false,
        output: `错误：未找到工具 "${name}" 的实现`,
        durationMs: Date.now() - start,
      };
      this.onToolCall?.({ type: 'executed', name, success: false, durationMs: result.durationMs, output: result.output });
      return result;
    }

    try {
      const rawResult = await this.withTimeout(
        Promise.resolve(fn(args)),
        this.toolTimeoutMs,
        `工具 ${name}`
      );

      // 多模态结果处理
      if (this.isMultimodalResult(rawResult)) {
        const multimodalContent = this.toMultimodalContent(rawResult);
        const textDesc = `[工具返回 ${multimodalContent.length} 张图片]`;
        const result: ToolExecutionResult = {
          success: true,
          output: textDesc,
          multimodalContent,
          durationMs: Date.now() - start,
        };
        this.onToolCall?.({ type: 'executed', name, success: true, durationMs: result.durationMs, output: textDesc });
        return result;
      }

      // 普通结果
      const outputStr = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
      const result: ToolExecutionResult = {
        success: true,
        output: outputStr,
        durationMs: Date.now() - start,
      };
      this.onToolCall?.({ type: 'executed', name, success: true, durationMs: result.durationMs, output: outputStr });
      return result;
    } catch (err) {
      const result: ToolExecutionResult = {
        success: false,
        output: `工具执行出错：${(err as Error).message}`,
        durationMs: Date.now() - start,
      };
      this.onToolCall?.({ type: 'executed', name, success: false, durationMs: result.durationMs, output: result.output });
      return result;
    }
  }

  // ==================== Reflection 四步闭环 ====================
  private async reflect(
    userMessage: string,
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    toolResults: ToolExecutionResult[]
  ): Promise<ReflectionResult> {
    const reflectionPrompt: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
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
        content: `用户任务：${userMessage}\n\n当前执行轨迹：\n${JSON.stringify(
          { messages: messages.slice(-6), toolResults: toolResults.slice(-4) },
          null,
          2
        )}`,
      },
    ];

    try {
      const response = (await this.createCompletion(reflectionPrompt, false, this.reflectionModel)) as OpenAI.Chat.Completions.ChatCompletion;
      const content = response.choices[0]?.message?.content ?? '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { verdict: 'continue', issues: ['反思输出无法解析'], corrections: [], confidence: 0.5 };
      }
      const parsed = JSON.parse(jsonMatch[0]) as ReflectionResult;
      return {
        verdict: parsed.verdict,
        issues: parsed.issues ?? [],
        corrections: parsed.corrections ?? [],
        replanStrategy: parsed.replanStrategy,
        confidence: parsed.confidence ?? 0.5,
      };
    } catch {
      return { verdict: 'continue', issues: ['反思过程异常，默认继续'], corrections: [], confidence: 0.3 };
    }
  }

  // ==================== 主运行方法 ====================
  async run(userMessage: string, options: RunOptions = {}): Promise<string> {
    const { onToken = this.onToken, stream = this.stream, clearHistory = false } = options;
    return this.withTimeout(
      this._runInternal(userMessage, { onToken, stream, clearHistory }),
      this.totalTimeoutMs,
      '整个 Agent 运行'
    );
  }

  private async _runInternal(
    userMessage: string,
    options: { onToken?: (token: string) => void; stream: boolean; clearHistory?: boolean }
  ): Promise<string> {
    const { onToken, stream, clearHistory = false } = options;

    // ==================== 多轮历史管理 ====================
    if (clearHistory) {
      this.history = [];
    }
    if (this.history.length === 0 && this.systemPrompt) {
      this.history.push({ role: 'system', content: this.systemPrompt });
    }
    this.history.push({ role: 'user', content: userMessage });

    const messages = this.history;

    let toolCallCount = 0;
    const allToolResults: ToolExecutionResult[] = [];

    // ==================== ReAct 外层循环 ====================
    for (let i = 0; i < this.maxIterations; i++) {
      if (i >= this.maxIterations - 1) {
        messages.push({
          role: 'system',
          content: '已达到最大迭代次数，请基于已有信息直接给出最终回答，不要再调用工具。',
        });
      }

      let content = '';
      let toolCalls: ToolCall[] = [];

      if (stream) {
        const response = (await this.createCompletion(messages, true)) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
        const accumulator: Record<number, AccumulatedToolCall> = {};

        for await (const chunk of response) {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            content += delta.content;
            onToken?.(delta.content);
          }
          this.accumulateToolCalls(accumulator, delta?.tool_calls);
        }
        toolCalls = this.buildToolCalls(accumulator);
      } else {
        const response = (await this.createCompletion(messages, false)) as OpenAI.Chat.Completions.ChatCompletion;
        const message = response.choices[0]?.message;
        content = message?.content ?? '';
        toolCalls = (message?.tool_calls as ToolCall[]) ?? [];
        if (content) onToken?.(content);
      }

      // ==================== 无工具调用：最终回答 ====================
      if (toolCalls.length === 0) {
        if (allToolResults.length > 0 && this.enableReflection) {
          await this.reflect(userMessage, messages, allToolResults);
        }
        // 写回历史
        this.history.push({ role: 'assistant', content });
        return content;
      }

      // ==================== 有工具调用：并发执行 ====================
      messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });

      const roundResults: ToolExecutionResult[] = [];
      const multimodalParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

      const results = await Promise.all(
        toolCalls.map((toolCall) => {
          toolCallCount++;
          return this.executeTool(toolCall, toolCallCount);
        })
      );

      toolCalls.forEach((toolCall, idx) => {
        const result = results[idx];
        roundResults.push(result);
        allToolResults.push(result);

        // tool 消息只支持字符串或纯文本 part，图片需要放在后续 user 消息中。
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result.output,
        });

        if (result.multimodalContent && result.multimodalContent.length > 0) {
          multimodalParts.push(...result.multimodalContent);
        }
      });

      // 先补齐全部 tool_call 的文本响应，再把图片作为多模态 user 消息交给模型。
      if (multimodalParts.length > 0) {
        const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
          {
            type: 'text',
            text: '以下图片是工具执行后返回的结果，请结合图片继续处理任务。',
          },
          ...multimodalParts,
        ];
        messages.push({ role: 'user', content: userContent });
      }

      // ==================== Reflection 内层闭环 ====================
      if (this.enableReflection && (i + 1) % this.reflectionInterval === 0) {
        const reflection = await this.reflect(userMessage, messages, roundResults);

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

    // ==================== 强制收尾 ====================
    const finalResponse = (await this.createCompletion(
      [
        ...messages,
        {
          role: 'system',
          content: '请基于以上全部信息，直接给出最终回答，不要再调用任何工具。',
        },
      ],
      false
    )) as OpenAI.Chat.Completions.ChatCompletion;

    const finalContent = finalResponse.choices[0]?.message?.content ?? '';
    if (finalContent) {
      this.onToken?.(finalContent);
      this.history.push({ role: 'assistant', content: finalContent });
    }
    return finalContent;
  }

  // ==================== 获取成本统计 ====================
  getCost(): CostTracker {
    return { ...this.cost };
  }

  // ==================== 获取/清空历史 ====================
  getHistory(): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }
}

// ==================== 导出 ====================
export { EnterpriseAgent };
export type {
  Tool,
  ToolFunction,
  ToolHandler,
  FunctionsMap,
  AgentOptions,
  RunOptions,
  JsonValue,
  ToolReturnValue,
  PermissionRule,
  GuardConfig,
  ReflectionResult,
  ToolExecutionResult,
  CostTracker,
  ToolCallEvent,
};
