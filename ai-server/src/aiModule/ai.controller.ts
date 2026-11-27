import { Controller, Get, Body, Res, HttpStatus, Post } from "@nestjs/common";
// import { AiService } from "./ai.service";
import type { Response } from 'express';
import {AiToolService} from './ai.toolService';

interface ChatRequest {
  message: string;
  systemPrompt?: string;
}


@Controller()
export class AiController{

    constructor(private readonly aiService: AiToolService){}


    // @Get('ai')
    // async chatBase(){
    //     await this.aiService.chatBase();
    // }


    @Post('aistream')
    async chatStream(@Body() body: ChatRequest, @Res() res: Response){
        const messages = [
            {
                role: 'system' as const,
                content: body.systemPrompt || '你是一个智能体，可以调用工具执行任务。',
            },
            { role: 'user' as const, content: body.message },
        ];

        const abortCtrl = new AbortController();

        try{
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Access-Control-Allow-Origin', '*');

            res.status(HttpStatus.OK);
            // 发送开始信号
            res.write('{"type": "start"}\n\n');

            // await this.aiService.streamChat(messages, {signal: abortCtrl.signal});
            for await (const chunk of this.aiService.streamChat(messages, {signal: abortCtrl.signal})) {
                const data = JSON.stringify(chunk);
                res.write(`${data}\n\n`)
            }

            // 发送结束信号
            res.write('{"type": "end"}\n\n');
            res.end();
        }catch(error: unknown){
            const errorData = JSON.stringify({
                type: 'error',
                error: '服务器内部错误',
                message: error instanceof Error ? error.message : '未知',
            });
            res.write(`data: ${errorData}\n\n`);
            res.end();
        }
        
    }

}