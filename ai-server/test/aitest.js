// const response = await fetch('/chat/stream/sess_123', {
//   method: 'POST',
//   headers: {
//     'Content-Type': 'application/json',
//     'Authorization': `Bearer ${token}`, // ✅ 任意 header
//   },
//   body: JSON.stringify({ message: '很长的消息...'.repeat(100) }), // ✅ 无长度限制
// });

// const reader = response.body!.getReader();
// const decoder = new TextDecoder();
// let buffer = '';

// while (true) {
//   const { done, value } = await reader.read();
//   if (done) break;

//   buffer += decoder.decode(value, { stream: true });
//   const lines = buffer.split('\n');
//   buffer = lines.pop() || '';

//   for (const line of lines) {
//     if (!line.trim()) continue;
//     const event = JSON.parse(line);
//     if (event.type === 'content') appendToUI(event.text);
//     if (event.type === 'done') console.log('完成');
//     if (event.type === 'error') showError(event.message);
//   }
// }

async function streamChat(message) {
const abortCtrl = new AbortController();
const signal =  abortCtrl.signal;
//  signal: AbortSignal.timeout(120000), // 兜底总超时

  const resp = await fetch(`http://localhost:3003/aistream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json'},
    body: JSON.stringify({ message }),
    signal, // 支持用户主动停止
    onError: (err) => console.error(err),
  });

  if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue; // 心跳

      const event = JSON.parse(line);
    //   const event = line;
    //   console.log("event==========", event)
      switch (event.type) {
            case 'content': console.log(event.content); break;
            // case 'human_mode': onHumanMode(event.message); break;
            case 'error':      onError(event); break;   // 有 code / retryable
            // case 'done':       onDone(event.usage); break;
            case 'done': console.log('结束'); break;
        }
    }
  }
};

streamChat('北京今天天气怎么样？');