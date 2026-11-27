import { OpenAIAgent, Tool, FunctionsMap } from './OpenAIAgent.service';

// ============ 1. 定义工具 Schema ============
const tools: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '获取指定城市的当前天气',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: '城市名称' },
        },
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
        properties: {
          timezone: { type: 'string', description: 'IANA 时区' },
        },
        required: ['timezone'],
      },
    },
  },
];

// ============ 2. 定义工具实现 ============
const functions: FunctionsMap = {
  async get_weather(args) {
    const city = args.city as string;
    return `${city}现在的天气是晴朗，25°C`;
  },
  async get_time(args) {
    const timezone = args.timezone as string;
    return new Date().toLocaleString('zh-CN', { timeZone: timezone });
  },
};

// ============ 3. 创建 agent 实例 ============
const agent = new OpenAIAgent({
  model: 'gpt-4o',
  tools,
  functions,
  maxIterations: 5,
  maxRetries: 2,
  stream: true,
  systemPrompt: '你是一个乐于助人的助手，回答要简洁。',
  onToken: (token) => process.stdout.write(token),
});

// ============ 4. 运行 ============
async function main() {
  const answer = await agent.run('北京天气怎么样？顺便告诉我上海时间。');
  console.log('\n\n最终回答长度：', answer.length);
}

main();
