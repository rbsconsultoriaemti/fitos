import { createApp } from './app';
import { config } from './shared/config';

createApp().listen(config.port, () => {
  console.log(`FitOS API rodando na porta ${config.port}`);
});
