import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/mast-proxy': {
            target: 'https://mast.stsci.edu',
            changeOrigin: true,
            secure: false,
            rewrite: (path) => path.replace(/^\/mast-proxy/, ''),
          },
        },
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      optimizeDeps: {
        exclude: ['onnxruntime-web'],
      },
      assetsInclude: ['**/*.wasm'],
    };
});
