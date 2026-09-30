import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true, // 端口被占用时报错退出，而不是自动改用 5174
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
});
