import { defineConfig } from 'vite';
import  react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));


export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, '.')
        },
        extensions: ['.js', '.ts', '.jsx', '.tsx']
    },
    build: {
        minify: true,  // 使用terser进行更深度的代码压缩
        chunkSizeWarningLimit: 1500,  // 分块大小警告阈值(KB)，超过会提示
        rolldownOptions: {
            output: {
                manualChunks(id) {
                    // 将 React 相关库打包成单独的 chunk 中
                    const moduleId = id.replace(/\\\\/g, '/');
                    if (moduleId.includes('/node_modules/react/') || moduleId.includes('/node_modules/react-dom/')) {
                        return 'react-vendor';
                    }
                },
            }
        }
    }
})
