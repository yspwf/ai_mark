import { Module } from "@nestjs/common";
import { AiController } from "./ai.controller";
// import { AiService } from "./ai.service";
import { AiToolService } from './ai.toolService';

@Module({
    controllers: [AiController],
    providers: [
        // AiService, 
        AiToolService
    ],
    exports: [],
    imports: []
})
export class AiModule{}

