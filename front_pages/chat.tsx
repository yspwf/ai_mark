import React, { memo, useEffect, useRef, useState } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
// import './chat.css';   // 把样式搬进 CSS 文件

const API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
const API_KEY = 'sk-aaqvxuzrclquxrfjnufjcbwrudqotpgmvwuirnazzsmmeudw'; // ⚠️ 见文末
const MODEL = 'zai-org/GLM-5.3-Flash';

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isStreaming?: boolean;
}

/* ---------- 代码块：模块级，引用稳定 ---------- */

function getText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getText).join('');
  if (React.isValidElement(node))
    return getText((node.props as { children?: React.ReactNode }).children);
  return '';
}

type PreProps = React.ComponentPropsWithoutRef<'pre'> & ExtraProps;

function CodeBlock({ node, children, ...props }: PreProps) {
  const [copied, setCopied] = useState(false);
  const text = getText(children).replace(/\n$/, '');

  return (
    <div className="code-block-wrapper">
      <pre {...props}>{children}</pre>
      <button
        className="copy-button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {}
        }}
      >
        {copied ? '已复制' : 'Copy'}
      </button>
    </div>
  );
}

/* components 是模块级常量，永不重建 */
const markdownComponents: Components = {
  img: ({ node, ...props }) => (
    <img
      {...props}
      style={{ maxWidth: '100%', borderRadius: 8 }}
      alt={props.alt || '图片'}
    />
  ),
  pre: CodeBlock,
};

/* ---------- 消息项：memo，历史消息零重渲染 ---------- */

const MessageItem = memo(function MessageItem({ msg }: { msg: ChatMsg }) {
  return (
    <div className="message">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={markdownComponents}
      >
        {msg.text}
      </ReactMarkdown>
      {msg.isStreaming && <div className="streaming-indicator" />}
    </div>
  );
});

/* ---------- 主组件 ---------- */

export default function ChatComponent() {
  const [historyContent, setHistoryContent] = useState<ChatMsg[]>([]);

  // rAF 合帧
  const bufferRef = useRef('');
  const rafRef = useRef<number | null>(null);
  const targetIdRef = useRef<string | null>(null);

  useEffect(() => {
      if (rafRef.current !== null) rafRef.current;
    }, []);

  const scheduleFlush = () => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const id = targetIdRef.current;
      if (!id) return;
      const text = bufferRef.current;
      setHistoryContent(prev =>
        prev.map(m => (m.id === id ? { ...m, text } : m))
      );
    });
  };

  const handleStreamRequest = async (curContent: string) => {
    const userId = `u_${Date.now()}`;
    const botId = `b_${Date.now()}`;
    targetIdRef.current = botId;
    bufferRef.current = '';

    // ① 先占位（修掉 Bug 2）
    setHistoryContent(prev => [
      ...prev,
      { id: userId, role: 'user', text: curContent },
      { id: botId, role: 'assistant', text: '', isStreaming: true },
    ]);

    try {
    //   const response = await fetch('https://api.coze.cn/v3/chat', {
    //     method: 'POST',
    //     headers: {
    //       Authorization: 'Bearer YOUR_TOKEN',
    //       'Content-Type': 'application/json',
    //     },
    //     body: JSON.stringify({
    //       bot_id: '74768042021',
    //       user_id: '123456',
    //       stream: true,
    //       auto_save_history: true,
    //       additional_messages: [
    //         { role: 'user', content: curContent, content_type: 'text' },
    //       ],
    //     }),
    //   });
    const ctrl = new AbortController();

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: curContent, content_type: 'text' }],
          stream: true,
        }),
        signal: ctrl.signal,
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `HTTP ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder('utf-8');
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
     
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // ② SSE 按空行分事件（修掉 ⑥）
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const event = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLine = event
            .split('\n')
            .find(l => l.startsWith('data:'));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
   
          try {
            const json = JSON.parse(payload);
            console.log("json===========", json)
            const piece = json?.choices?.[0].delta.content;
            // console.log("piece===========", piece)
            const delta = json.choices?.[0]?.delta ?? {};
            if (delta.content)          console.log('[正文]', delta.content);
            if (delta.reasoning_content) console.log('[思考]', delta.reasoning_content);
            if (typeof piece === 'string' && piece) {
              bufferRef.current += piece;  // ③ 只累积
              scheduleFlush();             // ④ 按帧刷新
            }
          } catch {}
        }
      }
    } catch (err) {
       // 错误处理
        // if (err.name === 'AbortError') {
        //   // 非中断错误，更新AI消息状态
        // }
      
    } finally {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const id = targetIdRef.current;
      const finalText = bufferRef.current;
      // ⑤ 兜底落地 + 去掉 streaming 标记
      setHistoryContent(prev =>
        prev.map(m =>
          m.id === id ? { ...m, text: finalText, isStreaming: false } : m
        )
      );
      targetIdRef.current = null;
    }
  };

  return (
    <div className="chat-container">
      {historyContent.map(msg => (
        <MessageItem key={msg.id} msg={msg} />
      ))}

      <button onClick={ () =>  handleStreamRequest('你好！') }>click</button>
    </div>
  );
}