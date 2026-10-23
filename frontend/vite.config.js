import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo, Vite reenvía /api y /health al API Gateway.
// Así el navegador solo habla con un origen y no se requiere CORS.
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const gatewayUrl = env.API_GATEWAY_URL || 'http://localhost:3000';

    return {
        plugins: [react()],
        server: {
            host: '0.0.0.0',
            port: 5173,
            proxy: {
                '/api': { target: gatewayUrl, changeOrigin: true },
                '/health': { target: gatewayUrl, changeOrigin: true }
            }
        }
    };
});
