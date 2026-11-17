import { useEffect, useRef, useState } from 'react';
import StreamingMarkdown from './components/StreamingMarkdown';

type Role = 'user' | 'assistant';
type ApiMessage = { role: 'system' | 'user' | 'assistant'; content: string };

interface ChatMessage { role: Role; content: string; }
interface Conversation {
  id: string;
  title: string;
  renamed: boolean;
  messages: ChatMessage[];
  updatedAt: number;
}

const API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
const API_KEY = 'sk-aaqvxuzrclquxrfjnufjcbwrudqotpgmvwuirnazzsmmeudw'; // ⚠️ 见文末
const MODEL = 'zai-org/GLM-5.3-Flash';
const STORAGE_KEY = 'ai_chat_conversations_v1';

const SYSTEM_PROMPT = `你是一个乐于助人的 AI 助手。
回答请使用 Markdown 格式，代码用代码块包裹并标注语言。
如果用户问题涉及"当前对话主题"或"之前的对话"，请参考 system 消息中提供的信息。`;

/* ---------- 工具 ---------- */

let idSeq = 0;
const genId = () => `c_${Date.now().toString(36)}_${++idSeq}`;

function createNewConversation(): Conversation {
  return {
    id: genId(),
    title: '新对话',
    renamed: false,
    messages: [],
    updatedAt: Date.now(),
  };
}

function loadInitial(): { conversations: Conversation[]; activeId: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const list: Conversation[] = parsed.conversations || [];
      const firstConversation = list[0];
      if (firstConversation) {
        const id =
          parsed.activeId && list.some(c => c.id === parsed.activeId)
            ? parsed.activeId
            : firstConversation.id;
        return { conversations: list, activeId: id };
      }
    }
  } catch { /* 读失败回退到全新数据 */ }
  const c = createNewConversation();
  return { conversations: [c], activeId: c.id };
}

function getContent(data: any, isDelta: boolean): string {
  const choice = data?.choices?.[0];
  if (!choice) return '';
  return isDelta ? choice.delta?.content ?? '' : choice.message?.content ?? '';
}

/* ---------- 主组件 ---------- */

function App() {
  const [initial] = useState(loadInitial);
  const [conversations, setConversations] = useState<Conversation[]>(initial.conversations);
  const [activeId, setActiveId] = useState(initial.activeId);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef('');                 // rAF 合帧缓冲
  const rafRef = useRef<number | null>(null);
  const streamConvIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const skipBlurRef = useRef(false);

  const activeConversation = conversations.find(c => c.id === activeId);
  const messages = activeConversation?.messages ?? [];

  // 持久化
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ conversations, activeId }));
    } catch { /* 隐私模式等写失败忽略 */ }
  }, [conversations, activeId]);

  // 消息变化滚到底
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // 卸载时中断
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  /* ---------- 消息更新 ---------- */

  const updateMessages = (
    convId: string,
    updater: (prev: ChatMessage[]) => ChatMessage[]
  ) => {
    setConversations(prev =>
      prev.map(c =>
        c.id === convId
          ? { ...c, messages: updater(c.messages), updatedAt: Date.now() }
          : c
      )
    );
  };

  const patchLastAssistant = (convId: string, content: string) => {
    updateMessages(convId, prev => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== 'assistant') return prev;
      const next = prev.slice();
      next[next.length - 1] = { ...last, content };
      return next;
    });
  };

  const removeEmptyLastAssistant = (convId: string) => {
    updateMessages(convId, prev => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== 'assistant' || last.content) return prev;
      return prev.slice(0, -1);
    });
  };

  /* ---------- rAF 合帧 ---------- */

  const scheduleFlush = () => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const convId = streamConvIdRef.current;
      if (convId) patchLastAssistant(convId, bufferRef.current);
    });
  };

  /* ---------- 中断当前请求 ---------- */

  const interruptCurrentStream = () => {
    const ctrl = abortRef.current;
    if (ctrl) {
      ctrl.abort();
      abortRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    // 把已收到的内容落地到旧会话
    const oldConvId = streamConvIdRef.current;
    if (oldConvId) {
      if (bufferRef.current) patchLastAssistant(oldConvId, bufferRef.current);
      else removeEmptyLastAssistant(oldConvId);
    }
    bufferRef.current = '';
    streamConvIdRef.current = null;
    setLoading(false);
  };

  /* ---------- 请求 ---------- */

  const streamResponse = async (convId: string, apiMessages: ApiMessage[]) => {
    setLoading(true);
    bufferRef.current = '';
    streamConvIdRef.current = convId;

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
          messages: apiMessages,
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
              bufferRef.current += delta;
              scheduleFlush();
            }
          } catch { /* 不完整 SSE 片段跳过 */ }
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
      if ((err as Error).name !== 'AbortError') {
        bufferRef.current = '';
        patchLastAssistant(convId, `⚠️ 请求失败：${(err as Error).message}`);
      }
    } finally {
      // 已被切换会话主动清理，跳过
      if (abortRef.current !== ctrl) return;

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (bufferRef.current) {
        patchLastAssistant(convId, bufferRef.current);
      } else {
        removeEmptyLastAssistant(convId);
      }
      bufferRef.current = '';
      streamConvIdRef.current = null;
      abortRef.current = null;
      setLoading(false);
    }
  };

  /* ---------- 组装请求 ---------- */

  const buildApiMessages = (
    conv: Conversation,
    all: Conversation[]
  ): ApiMessage[] => {
    const parts = [SYSTEM_PROMPT];

    // 当前会话标题 → 告诉模型主题
    if (conv.title && conv.title !== '新对话') {
      parts.push(`当前对话主题：${conv.title}`);
    }

    // 侧边栏其他会话标题 → 让模型有"用户关注过的话题"的感知
    const recent = all
      .filter(c => c.id !== conv.id && c.title && c.title !== '新对话')
      .slice(0, 5)
      .map(c => `- ${c.title}`);
    if (recent.length) {
      parts.push(
        `用户最近的其他对话话题（仅供参考，不必主动提及）：\n${recent.join('\n')}`
      );
    }

    return [
      { role: 'system', content: parts.join('\n\n') },
      ...conv.messages.map(m => ({ role: m.role, content: m.content })),
    ];
  };

  /* ---------- 发送 ---------- */

  const handleSend = () => {
    const text = input.trim();
    if (!text || loading || !activeConversation) return;

    const convId = activeConversation.id;
    const userMsg: ChatMessage = { role: 'user', content: text };

    // 请求体里包含新 user 消息（不含空 assistant 占位）
    const convForRequest: Conversation = {
      ...activeConversation,
      messages: [...activeConversation.messages, userMsg],
    };
    const apiMessages = buildApiMessages(convForRequest, conversations);

    // UI 立刻显示 user + 空 assistant 占位
    updateMessages(convId, prev => [
      ...prev,
      userMsg,
      { role: 'assistant', content: '' },
    ]);

    // 首条消息自动生成标题（仅当未手动改过）
    if (!activeConversation.renamed && activeConversation.title === '新对话') {
      const source = text.replace(/\s+/g, ' ');
      const title = source.length > 20 ? source.slice(0, 20) + '…' : source;
      setConversations(prev =>
        prev.map(c => (c.id === convId ? { ...c, title, updatedAt: Date.now() } : c))
      );
    }

    setInput('');
    void streamResponse(convId, apiMessages);
  };

  const handleStop = () => abortRef.current?.abort();

  /* ---------- 侧边栏操作 ---------- */

  const handleNewConversation = () => {
    interruptCurrentStream();
    const c = createNewConversation();
    setConversations(prev => [c, ...prev]);
    setActiveId(c.id);
    setInput('');
  };

  const handleSwitchConversation = (id: string) => {
    if (id === activeId) return;
    interruptCurrentStream();
    setActiveId(id);
    setInput('');
  };

  const handleDeleteConversation = (id: string) => {
    if (id === activeId) interruptCurrentStream();
    const remaining = conversations.filter(c => c.id !== id);
    if (remaining.length === 0) {
      const c = createNewConversation();
      setConversations([c]);
      setActiveId(c.id);
    } else {
      setConversations(remaining);
      const nextConversation = remaining[0];
      if (id === activeId && nextConversation) {
        setActiveId(nextConversation.id);
      }
    }
    setInput('');
  };

  const startRename = (conv: Conversation) => {
    setEditingId(conv.id);
    setEditValue(conv.title);
  };

  const finishRename = (commit: boolean) => {
    if (!editingId) return;
    if (commit) {
      const t = editValue.trim();
      if (t) {
        setConversations(prev =>
          prev.map(c =>
            c.id === editingId
              ? { ...c, title: t, renamed: true, updatedAt: Date.now() }
              : c
          )
        );
      }
    }
    setEditingId(null);
    setEditValue('');
  };

  /* ---------- 渲染 ---------- */

  return (
    <div style={styles.app}>
      {/* ============ 左侧边栏 ============ */}
      <aside style={{ ...styles.sidebar, ...(sidebarCollapsed ? styles.sidebarCollapsed : {}) }}>
        <div style={styles.sidebarHeader}>
          <button style={styles.newChatBtn} onClick={handleNewConversation}>
            <span>＋</span> 新建对话
          </button>
        </div>

        <nav style={styles.chatList}>
          {conversations.map(conv => {
            const isActive = conv.id === activeId;
            const isEditing = editingId === conv.id;
            return (
              <div
                key={conv.id}
                style={{ ...styles.chatItem, ...(isActive ? styles.chatItemActive : {}) }}
                onClick={() => { if (!isEditing) handleSwitchConversation(conv.id); }}
              >
                {isEditing ? (
                  <input
                    style={styles.renameInput}
                    value={editValue}
                    autoFocus
                    maxLength={60}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        skipBlurRef.current = true;
                        finishRename(true);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        skipBlurRef.current = true;
                        finishRename(false);
                      }
                    }}
                    onBlur={() => {
                      if (skipBlurRef.current) {
                        skipBlurRef.current = false;
                        return;
                      }
                      finishRename(true);
                    }}
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <span
                      style={styles.chatTitle}
                      title={`${conv.title}（双击重命名）`}
                      onDoubleClick={e => { e.stopPropagation(); startRename(conv); }}
                    >
                      {conv.title}
                    </span>
                    <button
                      style={styles.iconBtnSidebar}
                      title="重命名"
                      onClick={e => { e.stopPropagation(); startRename(conv); }}
                    >
                      ✎
                    </button>
                    <button
                      style={styles.iconBtnSidebar}
                      title="删除对话"
                      onClick={e => { e.stopPropagation(); handleDeleteConversation(conv.id); }}
                    >
                      🗑
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </nav>

        <div style={styles.sidebarFooter}>AI Chat · React + SiliconFlow</div>
      </aside>

      {/* ============ 主聊天区 ============ */}
      <main style={styles.main}>
        <header style={styles.topbar}>
          <button
            style={styles.iconBtn}
            onClick={() => setSidebarCollapsed(v => !v)}
            title="切换侧边栏"
          >
            ☰
          </button>
          <span style={styles.currentTitle}>{activeConversation?.title ?? '新对话'}</span>
          <span style={styles.modelTag}>{MODEL}</span>
        </header>

        <section style={styles.messages} ref={listRef}>
          {messages.length === 0 ? (
            <div style={styles.emptyState}>
              <div style={{ fontSize: 40 }}>🤖</div>
              <h2 style={{ fontSize: 22, color: '#1f2328', fontWeight: 600 }}>
                有什么可以帮你？
              </h2>
              <p style={{ fontSize: 14 }}>开始输入你的问题，支持多轮对话。</p>
            </div>
          ) : (
            messages.map((msg, i) => (
              <MessageBubble
                key={i}
                msg={msg}
                streaming={
                  loading && i === messages.length - 1 && msg.role === 'assistant'
                }
              />
            ))
          )}
        </section>

        <div style={styles.inputArea}>
          <div style={styles.inputWrapper}>
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
              style={styles.textInput}
            />
            {loading ? (
              <button onClick={handleStop} style={btnStyle('#ef4444')}>
                停止
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                style={{
                  ...btnStyle('#10a37f'),
                  opacity: input.trim() ? 1 : 0.45,
                  cursor: input.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                发送
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ---------- 子组件 ---------- */

function MessageBubble({ msg, streaming }: { msg: ChatMessage; streaming: boolean }) {
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

/* ---------- 样式 ---------- */

const styles = {
  app: {
    display: 'flex',
    height: '100vh',
    overflow: 'hidden',
    fontFamily: 'Inter, -apple-system, sans-serif',
  },
  sidebar: {
    width: 260,
    flexShrink: 0,
    background: '#202123',
    color: '#ececf1',
    display: 'flex',
    flexDirection: 'column',
    transition: 'margin-left 0.25s ease',
  },
  sidebarCollapsed: {
    marginLeft: -260,
  },
  sidebarHeader: {
    padding: 12,
    borderBottom: '1px solid rgba(255,255,255,0.1)',
  },
  newChatBtn: {
    width: '100%',
    padding: '11px 14px',
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 8,
    color: '#ececf1',
    fontSize: 14,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  chatList: {
    flex: 1,
    overflowY: 'auto',
    padding: 8,
  },
  chatItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 12px',
    marginBottom: 4,
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14,
    color: '#c5c5d2',
  },
  chatItemActive: {
    background: '#343541',
    color: '#fff',
  },
  chatTitle: {
    flex: 1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  },
  iconBtnSidebar: {
    background: 'none',
    border: 'none',
    color: '#8e8ea0',
    cursor: 'pointer',
    fontSize: 13,
    padding: '3px 5px',
    borderRadius: 4,
  },
  renameInput: {
    flex: 1,
    minWidth: 0,
    background: '#40414f',
    border: '1px solid #10a37f',
    borderRadius: 5,
    color: '#fff',
    fontSize: 14,
    fontFamily: 'inherit',
    padding: '3px 7px',
    outline: 'none',
  },
  sidebarFooter: {
    padding: 12,
    borderTop: '1px solid rgba(255,255,255,0.1)',
    fontSize: 12,
    color: '#8e8ea0',
    textAlign: 'center',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    background: '#f7f7f8',
  },
  topbar: {
    height: 56,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0 16px',
    borderBottom: '1px solid #e5e5e5',
    background: '#fff',
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 18,
    color: '#1f2328',
    padding: '6px 8px',
    borderRadius: 6,
  },
  currentTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#1f2328',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  modelTag: {
    marginLeft: 'auto',
    fontSize: 12,
    color: '#8e8ea0',
    border: '1px solid #e5e5e5',
    padding: '3px 8px',
    borderRadius: 20,
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px 450px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  emptyState: {
    margin: 'auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    padding: 20,
    color: '#8e8ea0',
    textAlign: 'center',
  },
  inputArea: {
    flexShrink: 0,
    padding: '0 24px 24px',
  },
  inputWrapper: {
    maxWidth: 1200,
    margin: '0 auto',
    display: 'flex',
    gap: 8,
    background: '#fff',
    border: '1px solid #e5e5e5',
    borderRadius: 14,
    padding: 8,
    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
  },
  textInput: {
    flex: 1,
    border: 'none',
    outline: 'none',
    padding: '8px 8px 8px 12px',
    fontSize: 15,
    fontFamily: 'inherit',
    background: 'transparent',
    color: '#1f2328',
  },
} satisfies Record<string, React.CSSProperties>;

export default App;
