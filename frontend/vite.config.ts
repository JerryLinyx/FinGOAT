import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
  ],
  server: {
    proxy: {
      // All API calls go through the Go backend.
      // The Python trading service (port 8001) is an internal worker only —
      // never called directly from the frontend.
      '/api': 'http://localhost:3000',
    },
  },
})
