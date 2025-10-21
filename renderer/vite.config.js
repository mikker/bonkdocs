import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const isDevBundle = mode === 'development'

  return {
    root: __dirname,
    base: './',
    plugins: [tailwindcss(), react()],
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: false,
      sourcemap: isDevBundle,
      minify: isDevBundle ? false : 'esbuild',
      rollupOptions: {
        output: {
          entryFileNames: `assets/[name].js`,
          chunkFileNames: `assets/[name].js`,
          assetFileNames: `assets/[name].[ext]`
        },
        external: ['path', 'events', 'child_process']
      }
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(
        isDevBundle ? 'development' : 'production'
      )
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src')
      }
    }
  }
})
