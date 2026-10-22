import { config } from '../../shared/config';
import { AppError } from '../../shared/errors';
import { truncate, type OnboardingLogger } from './onboarding.log';

export interface ClaudeToolResult {
  /** `input` da ferramenta, como a IA devolveu (ainda sem validar). */
  input: unknown;
  stopReason: string | null;
  /** Corpo bruto da resposta HTTP, para diagnóstico. */
  rawBody: string;
}

/**
 * Chama a Claude API (Messages) obrigando o uso de uma ferramenta, para receber JSON estruturado.
 * Registra a resposta bruta (completa em desenvolvimento) antes de qualquer parse.
 */
export async function callClaudeTool(
  opts: {
    system: string;
    user: string;
    tool: { name: string; description: string; input_schema: Record<string, unknown> };
    maxTokens?: number;
    timeoutMs?: number;
  },
  log: OnboardingLogger,
): Promise<ClaudeToolResult> {
  if (!config.anthropic.apiKey) {
    log.error('ANTHROPIC_API_KEY ausente');
    throw new AppError(503, 'ai_unavailable', 'Geração de plano por IA não configurada');
  }

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${config.anthropic.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': config.anthropic.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.anthropic.model,
        max_tokens: opts.maxTokens ?? 12000,
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
        tools: [opts.tool],
        tool_choice: { type: 'tool', name: opts.tool.name },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 110_000),
    });
  } catch (err) {
    log.error('falha de rede/timeout ao chamar a Claude API', { message: (err as Error).message, ms: Date.now() - started });
    throw new AppError(503, 'ai_unavailable', 'Serviço de IA indisponível, tente novamente');
  }

  const rawBody = await res.text();
  log.info('Claude API respondeu', { status: res.status, ms: Date.now() - started, model: config.anthropic.model });
  log.debug('resposta bruta da Claude (antes do parse)', rawBody);

  if (!res.ok) {
    // Em produção só um trecho do corpo de erro (mensagens da Anthropic não trazem a chave).
    log.error('Claude API devolveu erro', { status: res.status, body: truncate(rawBody, 1500) });
    throw new AppError(res.status === 429 || res.status === 529 ? 503 : 502, 'ai_error', 'A IA não conseguiu gerar o plano agora');
  }

  let body: { content?: { type: string; name?: string; input?: unknown }[]; stop_reason?: string };
  try {
    body = JSON.parse(rawBody);
  } catch (err) {
    log.error('resposta da Claude não é JSON', { message: (err as Error).message, body: truncate(rawBody, 1500) });
    throw new AppError(422, 'ai_invalid_response', 'A resposta da IA não pôde ser lida', { reason: 'not_json' });
  }
  const block = body.content?.find((b) => b.type === 'tool_use' && b.name === opts.tool.name);
  if (!block) {
    log.error('resposta sem tool_use esperado', { stopReason: body.stop_reason, body: truncate(rawBody, 1500) });
    throw new AppError(422, 'ai_invalid_response', 'A IA não devolveu o plano no formato esperado', {
      reason: 'no_tool_use',
      stopReason: body.stop_reason ?? null,
    });
  }
  return { input: block.input, stopReason: body.stop_reason ?? null, rawBody };
}
