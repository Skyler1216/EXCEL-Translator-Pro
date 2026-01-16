import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, (process as any).cwd(), '');

  return {
    plugins: [react()],
    define: {
      // Expose the API key safely to the client-side code
      // We map process.env.API_KEY to the VITE_API_KEY environment variable
      'process.env.API_KEY': JSON.stringify(env.VITE_API_KEY),
    },
  };
});