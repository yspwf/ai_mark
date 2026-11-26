const start = performance.now();
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3003);
  const durationMs = performance.now() - start;

  console.log(`启动时间: ${durationMs} ms`)
}

// await bootstrap();

bootstrap().catch((err) => {
  console.error('应用启动失败:', err);
  process.exit(1);
});