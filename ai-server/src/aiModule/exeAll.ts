import { EnterpriseAgent, Tool, FunctionsMap, PermissionRule } from './all';

// ==================== 工具 Schema ====================
const tools: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '获取指定城市的当前天气',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string', description: '城市名称' } },
        required: ['city'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_chart',
      description: '生成数据图表（返回图片）',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string', description: '图表标题' } },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: '删除指定文件（危险操作）',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '文件路径' } },
        required: ['path'],
      },
    },
  },
];

// ==================== 工具实现（含多模态）====================
const functions: FunctionsMap = {
  async get_weather(args) {
    const city = args.city as string;
    await new Promise((r) => setTimeout(r, 50)); // 模拟异步
    return `${city}现在的天气是晴朗，25°C`;
  },
  async generate_chart(args) {
    const title = args.title as string;
    // 返回图片 URL（多模态）
    return {
      imageUrl: `https://example.com/charts/${encodeURIComponent(title)}.png`,
    };
  },
  async delete_file(args) {
    return `已删除文件：${args.path}`;
  },
};

// ==================== 权限规则 ====================
const rules: PermissionRule[] = [
  {
    tool: 'delete_file',
    effect: 'deny',
    reason: '删除文件属于危险操作，当前 Agent 无权限执行',
  },
];

// ==================== 创建 Agent ====================
const agent = new EnterpriseAgent({
  model: 'gpt-4o',
  tools,
  functions,
  rules,
  stream: true,
  systemPrompt: '你是一个乐于助人的助手，回答要简洁准确。',

  // 四重约束
  maxIterations: 8,
  maxToolCallsPerRun: 20,
  llmTimeoutMs: 30_000,
  toolTimeoutMs: 10_000,
  totalTimeoutMs: 120_000,
  maxBudgetUsd: 1.0,
  maxTokensPerRequest: 4000,

  // Reflection
  enableReflection: true,
  reflectionModel: 'gpt-4o-mini',
  reflectionInterval: 1,

  // 流式输出
  onToken: (token) => process.stdout.write(token),

  // 工具调用日志
  onToolCall: (event) => {
    switch (event.type) {
      case 'start':
        console.log(`\n🔧 [工具调用 #${event.index}] 开始解析...`);
        break;
      case 'delta':
        if (event.name) process.stdout.write(event.name);
        if (event.argsChunk) process.stdout.write(event.argsChunk);
        break;
      case 'complete':
        console.log(`\n✅ [工具调用] ${event.name}(${event.fullArgs})`);
        break;
      case 'executed':
        console.log(
          `\n${event.success ? '✔' : '✘'} [执行结果] ${event.name} 耗时 ${event.durationMs}ms → ${event.output}`
        );
        break;
    }
  },
});

// ==================== 运行：多轮对话示例 ====================
async function main() {
  try {
    console.log('========== 第一轮：查询天气 ==========\n');
    const answer1 = await agent.run('查询一下北京的天气。');
    console.log('\n\n--- 第一轮回答 ---\n', answer1);

    console.log('\n\n========== 第二轮：追问（带上下文）==========\n');
    const answer2 = await agent.run('那上海呢？');
    console.log('\n\n--- 第二轮回答 ---\n', answer2);

    console.log('\n\n========== 第三轮：生成图表（多模态）==========\n');
    const answer3 = await agent.run('帮我生成一个"2024年销售额"的图表。');
    console.log('\n\n--- 第三轮回答 ---\n', answer3);

    console.log('\n\n========== 第四轮：清空历史重新开始 ==========\n');
    const answer4 = await agent.run('你好，请介绍一下你自己。', { clearHistory: true });
    console.log('\n\n--- 第四轮回答 ---\n', answer4);

    console.log('\n\n========== 成本统计 ==========\n', agent.getCost());
  } catch (err) {
    console.error('\nAgent 运行失败：', (err as Error).message);
  }
}

main();
