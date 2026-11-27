import { Injectable } from "@nestjs/common";
import OpenAI from 'openai';
import { AIServiceConfig, ChatStreamChunk, StreamChatOptions } from './config';
import type { CompletionUsage } from 'openai/resources';

interface PendingToolCall {
  id?: string;
  name?: string;
  arguments: string;
}

type AssistantMsg = OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam;
type ToolMsg = OpenAI.Chat.Completions.ChatCompletionToolMessageParam;
type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;

/** 单次请求最多允许的「模型→工具→模型」轮数，防止死循环 */
const MAX_TOOL_ROUNDS = 5;

@Injectable()
export class AiToolService {
  private readonly openai: OpenAI;
  private readonly config: Required<AIServiceConfig>;

  constructor() {
    this.openai = new OpenAI({
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

  // ---------------------------------------------------------------
  // 对外主方法：带工具调用的流式对话
  // ---------------------------------------------------------------
  async *streamChat(
    messages: Msg[],
    options: StreamChatOptions = {},
  ): AsyncGenerator<ChatStreamChunk> {
    const startTime = performance.now();
    const { signal, model = this.config.model } = options;

    // 每轮会追加 assistant.tool_calls 和 tool 结果，所以用副本
    const workingMessages: Msg[] = [...messages];
    let totalUsage: CompletionUsage | undefined;
    let finalFinishReason: string | null = null;

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      // ---------- 1. 发起流式请求 ----------
      let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
      try {
        stream = await this.openai.chat.completions.create(
          {
            model,
            messages: workingMessages,
            stream: true,
            stream_options: { include_usage: true },
            tools: this.buildTools(),
            tool_choice: 'auto',
            temperature: 0.7, // 控制创造性，范围0-2
            max_tokens: 1000, // 限制回复长度
          },
          { signal },
        );
      } catch (error: unknown) {
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

      // ---------- 2. 消费流，聚合 tool_calls ----------
      const toolCallBuffer = new Map<number, PendingToolCall>();
      let roundFinishReason: string | null = null;

      try {
        for await (const chunk of stream) {
          if (signal?.aborted) {
            yield { type: 'error', code: 'ABORTED', message: '请求已取消', retryable: false };
            return;
          }

    

          if (chunk.usage) totalUsage = this.mergeUsage(totalUsage, chunk.usage);

          const choice = chunk.choices.at(0);
          if (!choice) continue;

          // 先 yield 文本增量（即使本 chunk 带 finish_reason 也不丢）
          const content = choice.delta?.content;

        const reasoning = chunk.choices[0]?.delta?.refusal || "";
        // const content = chunk.choices[0]?.delta?.content || "";
        if (reasoning) console.log("[推理过程]:", reasoning);
        if (content) console.log("[回答]:", content);

          if (content) yield { type: 'content', content };

          // 聚合 tool_calls 增量：以 index 为键，id/name 只在首片出现
          if (choice.delta.tool_calls) {
            for (const tc of choice.delta.tool_calls) {
              const idx = tc.index;
              if (!toolCallBuffer.has(idx)) {
                toolCallBuffer.set(idx, { arguments: '' });
              }
              const pending = toolCallBuffer.get(idx)!;
              if (tc.id) pending.id = tc.id;
              if (tc.function?.name) pending.name = tc.function.name;
              if (tc.function?.arguments) pending.arguments += tc.function.arguments;
            }
          }

          if (choice.finish_reason) roundFinishReason = choice.finish_reason;
        }
      } catch (error: unknown) {
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

      // 被 length 截断时 arguments 可能不完整，直接报错更安全
      if (roundFinishReason === 'length' && toolCallBuffer.size > 0) {
        yield {
          type: 'error',
          code: 'TOOL_CALL_TRUNCATED',
          message: '工具参数被截断，请增大 max_tokens',
          retryable: false,
        };
        return;
      }

      // ---------- 3. 无工具调用 → 正常结束 ----------
      if (roundFinishReason !== 'tool_calls' || toolCallBuffer.size === 0) {
        finalFinishReason = roundFinishReason;
        break;
      }

      // ---------- 4. 组装 tool_calls ----------
      const toolCalls: ToolCall[] = [...toolCallBuffer.entries()]
        .sort(([a], [b]) => a - b) // 保持模型给出的顺序
        .map(([, p], i) => {
          if (!p.id || !p.name) {
            throw new Error(`工具调用 #${i} 缺少 id 或 name`);
          }
          return {
            id: p.id,
            type: 'function' as const,
            function: { name: p.name, arguments: p.arguments },
          };
        });

      // 追加 assistant 消息（content 必须为 null）
      const assistantMsg: AssistantMsg = {
        role: 'assistant',
        content: null,
        tool_calls: toolCalls,
      };
      workingMessages.push(assistantMsg);

      // ---------- 5. 执行每个工具，追加 tool 消息 ----------
      for (const call of toolCalls) {
        let resultContent: string;
        try {
          const args = JSON.parse(call.function.arguments || '{}');
          const result = await this.executeTool(call.function.name, args);
          resultContent = JSON.stringify(result);
        } catch (err) {
          // 工具/解析失败不中断流程，把错误回传给模型让它纠正
          resultContent = JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const toolMsg: ToolMsg = {
          role: 'tool',
          tool_call_id: call.id,   // 必须与 assistant.tool_calls 的 id 对应
          content: resultContent,
        };
        workingMessages.push(toolMsg);
      }

      // ---------- 6. 轮数上限保护 ----------
      if (round === MAX_TOOL_ROUNDS) {
        yield {
          type: 'error',
          code: 'TOOL_LOOP_LIMIT',
          message: `工具调用超过 ${MAX_TOOL_ROUNDS} 轮，已中止`,
          retryable: false,
        };
        return;
      }

      // 进入下一轮：带着 tool 结果再次请求模型
    }

    // 全部轮次结束
    yield {
      type: 'done',
      finishReason: finalFinishReason,
      usage: totalUsage,
      durationMs: performance.now() - startTime,
    };
  }

  // ---------------------------------------------------------------
  // 工具注册 & 执行
  // ---------------------------------------------------------------

  private buildTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
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

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (name) {
      case 'searchWeather': {
        const city = typeof args.city === 'string' ? args.city : '';
        if (!city) throw new Error('缺少参数 city');
        return this.fakeWeather(city);
      }
      default:
        // 未知工具：抛错也会被上层序列化为 tool 消息回传给模型
        throw new Error(`未知工具: ${name}`);
    }
  }

  private async fakeWeather(city: string) {
    return { city, temp: '26°C', condition: '晴' };
  }

  // ---------------------------------------------------------------
  // 多轮 usage 合并（每轮都是独立计费，累加即可）
  // ---------------------------------------------------------------
  private mergeUsage(
    acc: CompletionUsage | undefined,
    cur: CompletionUsage,
  ): CompletionUsage {
    if (!acc) return { ...cur };
    return {
      prompt_tokens: acc.prompt_tokens + cur.prompt_tokens,
      completion_tokens: acc.completion_tokens + cur.completion_tokens,
      total_tokens: acc.total_tokens + cur.total_tokens,
      prompt_tokens_details: cur.prompt_tokens_details ?? acc.prompt_tokens_details,
      completion_tokens_details:
        cur.completion_tokens_details ?? acc.completion_tokens_details,
    };
  }
}
