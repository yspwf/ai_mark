import { useMemo } from 'react';
import VirtualChatList from './virtualList';
import type { ChatMessage } from './virtualList';

function Virtual() {
  // 模拟 1000 条消息
  const messages = useMemo<ChatMessage[]>(() => {
    return Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `这是第 ${i + 1} 条消息的内容... 欢迎使用高性能虚拟列表！`,
    }));
  }, []);

  return (
    <div style={{ padding: '20px', fontFamily: 'Inter, -apple-system, sans-serif', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ textAlign: 'center', fontSize: '24px', fontWeight: '700', color: '#333' }}>
        🚀 AI 聊天（1000+ 条消息）
      </h1>
      <p style={{ textAlign: 'center', color: '#666', marginBottom: '20px' }}>
        虚拟列表实现高性能渲染
      </p>
      <VirtualChatList messages={messages} />
      
      <div style={{ marginTop: '24px', padding: '16px', backgroundColor: '#f9f9f9', borderRadius: '12px', fontSize: '14px' }}>
        <strong>✅ 验证方法：</strong>
        <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
          <li>打开浏览器开发者工具 → Elements 面板</li>
          <li>观察 DOM 节点数量：应为 <strong>20~30 个</strong>，而非 1000+</li>
          <li>快速滚动到底部再回顶部，<strong>无卡顿</strong></li>
        </ul>
      </div>
    </div>
  );
}

export default Virtual;
