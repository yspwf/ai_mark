import OpenAI from 'openai';
import { ChatStreamChunk, StreamChatOptions } from './config';
export declare class AiService {
    private readonly openai;
    private readonly config;
    constructor();
    chatBase(): any;
    private fakeWeather;
    streamChat(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[], options?: StreamChatOptions): AsyncGenerator<ChatStreamChunk>;
}
