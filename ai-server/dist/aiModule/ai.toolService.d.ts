import OpenAI from 'openai';
import { ChatStreamChunk, StreamChatOptions } from './config';
type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export declare class AiToolService {
    private readonly openai;
    private readonly config;
    constructor();
    streamChat(messages: Msg[], options?: StreamChatOptions): AsyncGenerator<ChatStreamChunk>;
    private buildTools;
    private executeTool;
    private fakeWeather;
    private mergeUsage;
}
export {};
