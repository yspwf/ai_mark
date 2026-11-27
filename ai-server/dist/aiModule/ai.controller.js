"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiController = void 0;
const common_1 = require("@nestjs/common");
const ai_toolService_1 = require("./ai.toolService");
let AiController = class AiController {
    aiService;
    constructor(aiService) {
        this.aiService = aiService;
    }
    async chatStream(body, res) {
        const messages = [
            {
                role: 'system',
                content: body.systemPrompt || '你是一个智能体，可以调用工具执行任务。',
            },
            { role: 'user', content: body.message },
        ];
        const abortCtrl = new AbortController();
        try {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.status(common_1.HttpStatus.OK);
            res.write('{"type": "start"}\n\n');
            for await (const chunk of this.aiService.streamChat(messages, { signal: abortCtrl.signal })) {
                const data = JSON.stringify(chunk);
                res.write(`${data}\n\n`);
            }
            res.write('{"type": "end"}\n\n');
            res.end();
        }
        catch (error) {
            const errorData = JSON.stringify({
                type: 'error',
                error: '服务器内部错误',
                message: error instanceof Error ? error.message : '未知',
            });
            res.write(`data: ${errorData}\n\n`);
            res.end();
        }
    }
};
exports.AiController = AiController;
__decorate([
    (0, common_1.Post)('aistream'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AiController.prototype, "chatStream", null);
exports.AiController = AiController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [ai_toolService_1.AiToolService])
], AiController);
//# sourceMappingURL=ai.controller.js.map