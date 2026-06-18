import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // 开发环境
  server: {
    host: true,
    port: 6002,
    allowedHosts: ['api.ningxi.cc'],
  },
  // 部署预览
  preview: {
    host: true,
    port: 9966,
    allowedHosts: ['api.ningxi.cc'],
  },
})
