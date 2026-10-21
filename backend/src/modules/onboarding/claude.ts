import { config } from '../../shared/config';
import { AppError } from '../../shared/errors';


/**
 * Chama a Claude API (Messages) obrigando o uso de uma ferramenta, para receber JSON estruturado.
 * Devolve o `input` da ferramenta, já como objeto.
 */
export async function callClaudeTool(opts: {
  system: string;
  user: string;
  tool: { name: string; description: string; input_schema: Record<string, unknown> };
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<unknown> {
  if (!config.anthropic.apiKey) {
    throw new AppError(503, 'ai_unavailable', 'Geração de plano por IA não configurada');
  }

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
        max_tokens: opts.maxTokens ?? 8000,
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
        tools: [opts.tool],
        tool_choice: { type: 'tool', name: opts.tool.name },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 100_000),
    });
  } catch {
    throw new AppError(503, 'ai_unavailable', 'Serviço de IA indisponível, tente novamente');
  }

  if (!res.ok) {
    // Só o status vai para o log (nunca cabeçalhos nem a chave).
    console.error('[onboarding] Claude API respondeu', res.status);
    throw new AppError(res.status === 429 || res.status === 529 ? 503 : 502, 'ai_error', 'A IA não conseguiu gerar o plano agora');
  }

  const body = (await res.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
  const block = body.content?.find((b) => b.type === 'tool_use' && b.name === opts.tool.name);
  if (!block) throw new AppError(502, 'ai_error', 'Resposta inesperada da IA');
  return block.input;
}
