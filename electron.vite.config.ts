import path from 'path';
import react from '@vitejs/plugin-react';
import reactSWC from '@vitejs/plugin-react-swc';
import { defineConfig } from 'electron-vite';

export default defineConfig(({ command }) => {
  const prod = command === 'build';
  const rendererHost = process.env.FOUNDFISH_RENDERER_HOST || '127.0.0.1';

  const alias = {
    '@': path.resolve('src/renderer'),
    '@main': path.resolve('src/main'),
    '@lib': path.resolve('src/lib'),
  };

  return {
    main: {
      build: {
        outDir: 'release/app/dist/main',
        minify: prod,
        rollupOptions: {
          output: {
            format: 'es',
          },
        },
      },
      resolve: { alias },
    },
    preload: {
      build: {
        outDir: 'release/app/dist/preload',
        minify: prod,
        rollupOptions: {
          output: {
            format: 'cjs',
          },
        },
      },
      define: {
        __BUILD_DATE__: Date.now(),
      },
    },
    renderer: {
      build: {
        outDir: 'release/app/dist/renderer',
        minify: prod,
        cssCodeSplit: false,
        assetsInlineLimit: 1024 * 20,
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes('node_modules')) {
                if (id.includes('echarts') || id.includes('zrender')) {
                  return 'echarts';
                }
                if (id.includes('antd') || id.includes('rc-') || id.includes('@ant-design')) {
                  return 'antd';
                }
                if (id.includes('react') || id.includes('redux') || id.includes('react-dom') || id.includes('scheduler')) {
                  return 'react';
                }
                if (id.includes('dayjs') || id.includes('clsx') || id.includes('color')) {
                  return 'utils';
                }
                return 'vendor';
              }
              return null;
            },
          },
        },
      },
      server: {
        host: rendererHost,
        port: 3456,
        strictPort: true,
        proxy: {
          // Dev-only proxy to avoid CORS when calling Google Generative Language OpenAI-compatible endpoints
          // Usage in dev: set baseURL to http://localhost:3456/ai
          '/ai': {
            target: 'https://generativelanguage.googleapis.com/',
            changeOrigin: true,
            secure: true,
            rewrite: (p) => p.replace(/^\/ai/, ''),
          },
        },
      },
      plugins: [
        prod
          ? react({
              babel: {
                plugins: ['babel-plugin-react-compiler'],
              },
            })
          : reactSWC(),
      ],
      resolve: { alias },
    },
  };
});
