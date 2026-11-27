import type { Response } from 'express';
import { AiToolService } from './ai.toolService';
interface ChatRequest {
    message: string;
    systemPrompt?: string;
}
export declare class AiController {
    private readonly aiService;
    constructor(aiService: AiToolService);
    chatStream(body: ChatRequest, res: Response): any;
}
export {};
