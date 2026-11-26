import { Injectable } from "@nestjs/common";
import OpenAI from 'openai';
import { AIServiceConfig, ChatStreamChunk, StreamChatOptions } from './config';

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


    //对外主方法：带重试的流式对话
    // async *streamChat(
    //     messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    //     options: StreamChatOptions = {}
    // ): AsyncGenerator<ChatStreamChunk>{
    //     const startTime = performance.now();

    //     const {signal, model} = options;


    // }


}


