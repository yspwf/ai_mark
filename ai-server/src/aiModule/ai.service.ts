import { Injectable } from "@nestjs/common";
import OpenAI from 'openai';
import { AIServiceConfig, ChatStreamChunk, StreamChatOptions } from './config';
import type { CompletionUsage } from 'openai/resources';

interface PendingToolCall {
  id?: string;
  name?: string;
  arguments: string;
}

@Injectable()
export class AiService {

    private readonly openai: OpenAI;
    private readonly config: Required<AIServiceConfig>;

    constructor(){
        this.openai = new OpenAI({
            apiKey: 'sk-aaqvxuzrclquxrfjnufjcbwrudqotpgmvwuirnazzsmmeudw',
            baseURL: 'https://api.siliconflow.cn/v1',
            timeout: 120000
        })

        this.config = {
            timeoutMs: 120000,
            maxRetries: 2,
            maxInputTokens: 8000,
            totalTokenCircuitBreaker: 500000,
            baseRetryDelayMs: 1000,
            model: 'zai-org/GLM-5.3-Flash',
        };
    }


    async chatBase(){
        try{
            const res = await this.openai.chat.completions.create({
                model: this.config.model,
                messages: [
                    { role: 'system', content: '你是一个专业的技术助手，回答简洁、准确、不啰嗦' },
                    { role: 'user', content: '用 Node.js 调用 OpenAI 最好的参数配置是什么？' },
                ],
                temperature: 0.7,      // 0=严谨 1=平衡 2=天马行空
                max_tokens: 1024,      // 最大生成长度
                top_p: 1,
                frequency_penalty: 0,  // 减少重复
                presence_penalty: 0,   // 减少跑题
                stream: true, // 开启流式
            })

            // console.log(res.choices.at(0)?.message.content);
            for await (const chunk of res) {
                const content = chunk.choices[0]?.delta?.content || '';
                process.stdout.write(content); // 控制台实时打印
            }
        }catch(err){
            if (err instanceof OpenAI.APIError) {
                console.error('状态码:', err.status);
                console.error('错误信息:', err.error);
            }

            if (err instanceof OpenAI.AuthenticationError) console.log('密钥错误');
            if (err instanceof OpenAI.RateLimitError) console.log('限流了');
            if (err instanceof OpenAI.APIConnectionTimeoutError) console.log('请求超时');

            throw err;
        }
    }

    private async fakeWeather(city: string) {
        return {
            city,
            temp: "26°C",
            condition: "晴"
        };
    }

    //对外主方法：带重试的流式对话
    async *streamChat(
        messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        options: StreamChatOptions = {}
    ): AsyncGenerator<ChatStreamChunk>{
        const startTime = performance.now();

        const {signal, model} = options ?? {};

        let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>

        try{
            stream = await this.openai.chat.completions.create({
                model: this.config.model,
                messages,
                stream: true,
                stream_options: { include_usage: true},
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
            },{ signal });
        }catch(error: unknown){
            if(signal?.aborted){
                yield {type: "error", code:'ABORTED', message:'请求已取消', retryable: false}
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


        let finishReason: string | null = null;
        let usage: CompletionUsage | undefined;

        try{
            const toolCallBuffer = new Map<number, PendingToolCall>();
            for await (const chunk of stream) {
                // 信号终止则立刻退出生成器
                if(signal?.aborted) return;

                if(chunk.usage) usage = chunk.usage;
                const choice = chunk.choices.at(0);

                if(!choice) continue;

                if(choice.finish_reason) finishReason = choice.finish_reason;
                // console.log("finishReason============", finishReason, choice.delta)

                const content = choice.delta?.content;

                if(content) {
                    yield { type:'content', content}
                }
            }
        }catch(error: unknown){
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

        //正常结束
        yield {
            type: 'done',
            finishReason,
            usage,
            durationMs: performance.now() - startTime
        }
    }

}


