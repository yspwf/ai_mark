// import { useEffect, useState } from 'react';
// import StreamingMarkdown from './components/StreamingMarkdown';

// function App() {
//   const [displayedText, setDisplayedText] = useState('');

//   // 模拟 AI 返回的完整 Markdown 响应
//   const fullResponse = `# React-Markdown示例
// ## 1. 表格（需remark-gfm插件）
// | 姓名 | 技术栈 |
// |------|--------|
// | 张三 | React  |
// | 李四 | Vue    |
// ## 2. 代码块（自动高亮）
// \`\`\`javascript
// // React组件示例
// function App() {
//   return <h1>Hello Markdown</h1>;
// }
// \`\`\`
// ## 3. 数学公式（需remark-math+rehype-katex）
// 欧拉公式：$e^{iπ} + 1 = 0$

//   # 欢迎使用 AI 助手 🤖

// 这是一个支持 **流式渲染** 的 Markdown 示例。

// ## 代码高亮
// \`\`\`javascript
// // 打字机效果核心逻辑
// useEffect(() => {
//   let index = 0;
//   const interval = setInterval(() => {
//     if (index < fullResponse.length) {
//       setDisplayedText(fullResponse.slice(0, ++index));
//     } else {
//       clearInterval(interval);
//     }
//   }, 20);
//   return () => clearInterval(interval);
// }, []);
// \`\`\`

// ## 表格支持
// | 特性 | 支持情况 | 说明 |
// |------|---------|------|
// | 代码高亮 | ✅ | 使用 highlight.js |
// | 数学公式 | ✅ | 使用 KaTeX |
// | 表格 | ✅ | GitHub Flavored Markdown |
// | 流式输出 | ✅ | 逐字符渲染 |

// ## 数学公式
// 欧拉恒等式：$e^{i\\pi} + 1 = 0$

// 贝叶斯定理：
// $$
// P(A|B) = \\frac{P(B|A)P(A)}{P(B)}
// $$

// > 💡 所有内容安全渲染，无 XSS 风险！
// `;

//   // 模拟流式输出（每 20ms 追加一个字符）
//   useEffect(() => {
//     let index = 0;
//     const interval = setInterval(() => {
//       if (index < fullResponse.length) {
//         setDisplayedText(fullResponse.slice(0, index + 1));
//         index++;
//       } else {
//         clearInterval(interval);
//       }
//     }, 20);

//     return () => clearInterval(interval);
//   }, []);

//   return (
//     <div style={{ padding: '20px', fontFamily: 'Inter, -apple-system, sans-serif', maxWidth: '900px', margin: '0 auto' }}>
//       <h1 style={{ textAlign: 'center', fontSize: '24px', fontWeight: '700', color: '#333' }}>
//         📝 流式 Markdown 渲染
//       </h1>
//       <p style={{ textAlign: 'center', color: '#666', marginBottom: '20px' }}>
//         代码高亮 + 表格 + 数学公式，逐字输出
//       </p>

//       <div
//         style={{
//           border: '1px solid #e8e8e8',
//           borderRadius: '12px',
//           padding: '24px',
//           backgroundColor: '#fff',
//           boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
//           lineHeight: 1.6,
//         }}
//       >
//         <StreamingMarkdown content={displayedText} />
//       </div>

//       <div style={{ marginTop: '24px', padding: '16px', backgroundColor: '#f9f9f9', borderRadius: '12px', fontSize: '14px' }}>
//         <strong>✅ 验证方法：</strong>
//         <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
//           <li>文字像<strong>打字机</strong>一样逐字出现</li>
//           <li>JavaScript 代码块有<strong>语法高亮</strong></li>
//           <li>表格对齐整齐，有边框</li>
//           <li>数学公式渲染为<strong>图形</strong>（非原始 $...$ 字符）</li>
//           <li>无 XSS 风险（尝试输入 &lt;script&gt;，应被转义）</li>
//         </ul>
//       </div>
//     </div>
//   );
// }

// export default App;

import { useEffect, useRef, useState } from 'react';
import StreamingMarkdown from './components/StreamingMarkdown';

type ApiMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

const API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
const API_KEY = 'sk-aaqvxuzrclquxrfjnufjcbwrudqotpgmvwuirnazzsmmeudw';
const MODEL = 'zai-org/GLM-5.3-Flash';

const SYSTEM_MESSAGE: ApiMessage = {
  role: 'system',
  content: '你是一个乐于助人的 AI 助手。回答请使用 Markdown 格式，代码用代码块包裹。',
};

function getContent(data: any, isDelta: boolean): string {
  const choice = data?.choices?.[0];
  if (!choice) return '';
  return isDelta ? choice.delta?.content ?? '' : choice.message?.content ?? '';
}

function App() {
  const [messages, setMessages] = useState<ApiMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // ===== P0：rAF 合帧相关 =====
  const bufferRef = useRef('');          // 累积 delta，不触发渲染
  const rafRef = useRef<number | null>(null); // 已调度的帧

  // 消息变化时滚到底部
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // 卸载时取消未执行的 rAF，避免内存泄漏
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  // 只更新最后一条 assistant（函数式 setState 保证基于最新列表）
  const patchLastAssistant = (content: string) => {
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== 'assistant') return prev;
      const next = prev.slice();
      next[next.length - 1] = { ...last, content };
      return next;
    });
  };

  // 按帧调度：每帧最多触发一次 setState
  const scheduleFlush = () => {
    if (rafRef.current !== null) return; // 本帧已排过，合并
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      patchLastAssistant(bufferRef.current);
    });
  };

  const streamResponse = async (apiMessages: ApiMessage[]) => {
    setLoading(true);
    bufferRef.current = ''; // 新一轮请求，重置缓冲区

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [SYSTEM_MESSAGE, ...apiMessages],
          stream: true,
        }),
        signal: ctrl.signal,
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        // 非流式兜底：直接写入 buffer，finally 统一 flush
        const completion = await response.json();
        bufferRef.current = getContent(completion, false);
      } else {
        if (!response.body) throw new Error('Response body is empty');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const consumeLine = (line: string) => {
          if (!line.startsWith('data:')) return;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') return;
          try {
            const delta = getContent(JSON.parse(payload), true);
            if (delta) {
              bufferRef.current += delta; // ✅ 只累积
              scheduleFlush();            // ✅ 按帧调度，不直接 setState
            }
          } catch {
            // 不完整 SSE 片段跳过
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';
          lines.forEach(consumeLine);
          if (done) break;
        }
        if (buffer) consumeLine(buffer);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // 用户主动停止：保留已生成内容，finally 会 flush
      } else {
        bufferRef.current = ''; // 清空，避免 finally 覆盖错误信息
        patchLastAssistant(`⚠️ 请求失败：${(err as Error).message}`);
      }
    } finally {
      // 兜底：取消未执行的帧，确保最后一批内容一定落地
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (bufferRef.current) {
        patchLastAssistant(bufferRef.current);
      }
      abortRef.current = null;
      setLoading(false);
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ApiMessage = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg, { role: 'assistant', content: '' }]);
    setInput('');
    void streamResponse([...messages, userMsg]);
  };

  const handleStop = () => abortRef.current?.abort();

  const handleReset = () => {
    abortRef.current?.abort();
    setMessages([]);
    setInput('');
  };

  return (
    <div
      style={{
        padding: '20px',
        fontFamily: 'Inter, -apple-system, sans-serif',
        maxWidth: '900px',
        margin: '0 auto',
      }}
    >
      <h1 style={{ textAlign: 'center', fontSize: '24px', fontWeight: 700, color: '#333' }}>
        📝 流式 Markdown 对话
      </h1>
      <p style={{ textAlign: 'center', color: '#666', marginBottom: '16px' }}>
        SiliconFlow · 多轮对话 · 代码高亮 + 表格 + 数学公式
      </p>

      <div
        ref={listRef}
        style={{
          height: '60vh',
          overflowY: 'auto',
          border: '1px solid #e8e8e8',
          borderRadius: '12px',
          padding: '20px',
          backgroundColor: '#fff',
          boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        {messages.length === 0 && (
          <div style={{ margin: 'auto', color: '#aaa', textAlign: 'center' }}>
            输入问题开始对话 👇
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            msg={msg}
            streaming={loading && i === messages.length - 1 && msg.role === 'assistant'}
          />
        ))}
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="输入问题，Enter 发送"
          style={{
            flex: 1,
            padding: '10px 14px',
            border: '1px solid #ddd',
            borderRadius: 8,
            fontSize: 14,
            outline: 'none',
          }}
        />
        {loading ? (
          <button onClick={handleStop} style={btnStyle('#ef4444')}>
            停止
          </button>
        ) : (
          <button onClick={handleSend} disabled={!input.trim()} style={btnStyle('#10a37f')}>
            发送
          </button>
        )}
        <button onClick={handleReset} style={btnStyle('#666')} title="清空对话">
          重置
        </button>
      </div>
    </div>
  );
}

function MessageBubble({ msg, streaming }: { msg: ApiMessage; streaming: boolean }) {
  const isUser = msg.role === 'user';

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      {!isUser && <Avatar label="AI" bg="#10a37f" />}

      <div
        style={{
          maxWidth: '78%',
          padding: '10px 14px',
          borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
          background: isUser ? '#10a37f' : '#f7f7f8',
          color: isUser ? '#fff' : '#1f2328',
          fontSize: 14,
          lineHeight: 1.65,
          wordBreak: 'break-word',
          minWidth: 44,
        }}
      >
        {isUser ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
        ) : msg.content ? (
          <StreamingMarkdown content={msg.content} />
        ) : streaming ? (
          <span style={{ color: '#888' }}>正在生成…</span>
        ) : (
          <span style={{ color: '#aaa' }}>（无内容）</span>
        )}
      </div>

      {isUser && <Avatar label="你" bg="#5436da" />}
    </div>
  );
}

function Avatar({ label, bg }: { label: string; bg: string }) {
  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: 6,
        background: bg,
        color: '#fff',
        fontSize: 12,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {label}
    </div>
  );
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    padding: '10px 20px',
    border: 'none',
    borderRadius: 8,
    background: bg,
    color: '#fff',
    cursor: 'pointer',
    fontSize: 14,
  };
}

export default App;