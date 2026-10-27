export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Detalhes seguros para o cliente (ex.: lista de campos inválidos). */
    public readonly details?: unknown,
    /** Campos extras no nível raiz do corpo da resposta (ex.: `resetsAt` do 429 de cota). */
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}
