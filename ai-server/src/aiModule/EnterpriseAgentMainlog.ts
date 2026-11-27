import { EnterpriseAgent, Tool, FunctionsMap, PermissionRule } from './EnterpriseAgentLog';

// ==================== 1. 定义工具 Schema ====================
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
      name: 'get_time',
      description: '获取指定时区的当前时间',
      parameters: {
        type: 'object',
        properties: { timezone: { type: 'string', description: 'IANA 时区' } },
        required: ['timezone'],
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

// ==================== 2. 定义工具实现 ====================
const functions: FunctionsMap = {
  async get_weather(args) {
    const city = args.city as string;
    await new Promise((r) => setTimeout(r, 50)); // 模拟异步
    return `${city}现在的天气是晴朗，25°C`;
  },
  async get_time(args) {
    const timezone = args.timezone as string;
    return new Date().toLocaleString('zh-CN', { timeZone: timezone });
  },
  async delete_file(args) {
    return `已删除文件：${args.path}`;
  },
};

// ==================== 3. 权限规则 ====================
const rules: PermissionRule[] = [
  {
    tool: 'delete_file',
    effect: 'deny',
    reason: '删除文件属于危险操作，当前 Agent 无权限执行',
  },
];

// ==================== 4. 创建 Agent ====================
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

// ==================== 5. 运行 ====================
async function main() {
  try {
    console.log('开始运行...\n');
    const answer = await agent.run('查询一下北京的天气，顺便告诉我纽约时间。');
    console.log('\n\n--- 最终回答 ---\n', answer);
    console.log('\n--- 成本统计 ---\n', agent.getCost());
  } catch (err) {
    console.error('\nAgent 运行失败：', (err as Error).message);
  }
}

main();
