// src/components/VirtualChatList.jsx
import { useVirtual } from 'react-virtual';
import { useRef, useMemo } from 'react';

export type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
};

type VirtualChatListProps = {
  messages: readonly ChatMessage[];
};

const VirtualChatList = ({ messages }: VirtualChatListProps) => {
  const parentRef = useRef<HTMLDivElement | null>(null);

  // 固定每条消息高度（简化实现）
  const rowHeight = 60;

  const virtualizer = useVirtual(
    useMemo(() => ({
        size: messages.length,
        parentRef,
        estimateSize: () => rowHeight, // 修正：原模板误写为 rowTime
    }), [messages.length])
  );

  return (
    <div
      ref={parentRef}
      style={{
        height: '600px',
        overflow: 'auto',
        position: 'relative',
        border: '1px solid #e8e8e8',
        borderRadius: '8px',
        padding: '8px',
      }}
    >
      {/* 总体占位，撑起滚动条 */}
      <div
        style={{
          height: `${virtualizer.totalSize}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.virtualItems.map((virtualRow) => {
          const message = messages[virtualRow.index];
          if (!message) return null;

          return (
            <div
              key={virtualRow.index}
              ref={virtualRow.measureRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                height: `${rowHeight}px`,
                padding: '12px 16px',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                borderBottom: '1px solid #f0f0f0',
                backgroundColor: message.role === 'user' ? '#e6f7ff' : '#f6ffed',
                color: message.role === 'user' ? '#1890ff' : '#52c41a',
                fontWeight: '500',
              }}
            >
              {message.role === 'user' ? '👤 用户' : '🤖 AI'}: {message.content}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default VirtualChatList;
