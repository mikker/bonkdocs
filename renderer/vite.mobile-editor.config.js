import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'dist-mobile-editor'),
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(__dirname, 'src/mobile-editor/main.tsx'),
      name: 'BonkDocsMobileEditor',
      formats: ['iife'],
      fileName: () => 'mobile-editor.js'
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
})
