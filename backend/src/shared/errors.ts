export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Detalhes seguros para o cliente (ex.: lista de campos inválidos). */
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
