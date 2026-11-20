import { defineConfig, loadEnv } from 'vite';
import  react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { rmSync, existsSync } from 'node:fs';

if(existsSync('./dist-electron')) rmSync('./dist-electron', {recursive: true, force: true});
if(existsSync('./dist')) rmSync('./dist', {recursive: true, force: true});

export default defineConfig(({mode}) => {
    const env = loadEnv(mode, process.cwd());
    return {
        plugins: [
            react(),
            electron([
                { //主进程配置
                    entry: 'electron/index.ts',
                    onstart(options){
                        // 启动electron项目
                        options.startup();
                    },
                    vite: {
                        build: {
                            //构建出口
                            outDir: 'dist-electron/main',
                            rolldownOptions: {
                                external: ['child_process']
                            }
                        }
                    }
                },
                { //x渲染进程
                    entry: 'electron/preload.ts',
                    onstart(options){
                        // 加载渲染进程配置
                        options.reload();
                    },
                    vite: {
                        build: {
                            outDir: 'dist-electron/preload'
                        }
                    }
                }
            ]),
            renderer({
                // 渲染进程融入node
                // nodeIntegration: true,
            })
        ],
        resolve: {
            alias: {
                '~': path.resolve(__dirname, './'),
                '@': path.resolve(__dirname, './src')
            },
            extensions: ['.js', '.ts', '.jsx', '.tsx', '.json', '.css', '.scss']
        },
        base:"./",
        build: {
            emptyOutDir: true,
            assetsInlineLimit: 4096,
            minify: true,  // 使用terser进行更深度的代码压缩
            chunkSizeWarningLimit: 1500,  // 分块大小警告阈值(KB)，超过会提示
            rolldownOptions: {
                input: {
                    index: path.resolve(__dirname, './index.html')
                },
                output: {
                    manualChunks(id) {
                        // 将 React 相关库打包成单独的 chunk 中
                        const moduleId = id.replace(/\\\\/g, '/');
                        if (moduleId.includes('/node_modules/react/') || moduleId.includes('/node_modules/react-dom/')) {
                            return 'react-vendor';
                        }
                    },
                },
                external: ['child_process']
            }
        }
    };
})
