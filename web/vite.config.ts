import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// O portal é servido em /admin/ no mesmo domínio da API. Em desenvolvimento, o proxy manda as rotas da API
// para o backend local (mesma origem para o navegador, então o cookie do refresh token funciona como em produção).
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/portal': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
    },
  },
});
