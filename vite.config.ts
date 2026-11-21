import { defineConfig } from 'vite';

// base：默认用相对路径，产物放在任意目录（含 file:// 单文件版）都能运行；
// GitHub Pages 的工作流会通过 VITE_BASE 传入仓库子路径（如 /skyward-isles/）。
export default defineConfig({
  base: process.env.VITE_BASE || './',
  server: { host: true, port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
