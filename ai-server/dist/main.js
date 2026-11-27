"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const start = performance.now();
const core_1 = require("@nestjs/core");
const app_module_js_1 = require("./app.module.js");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_js_1.AppModule);
    await app.listen(process.env.PORT ?? 3003);
    const durationMs = performance.now() - start;
    console.log(`启动时间: ${durationMs} ms`);
}
bootstrap().catch((err) => {
    console.error('应用启动失败:', err);
    process.exit(1);
});
//# sourceMappingURL=main.js.map