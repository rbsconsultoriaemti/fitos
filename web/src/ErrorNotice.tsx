import { describeError } from './api';

/** Mensagem de erro de uma chamada ao backend (403 vira aviso de permissão, nunca tela em branco). */
export default function ErrorNotice({ error }: { error: unknown }) {
  return (
    <div className="card empty" role="alert">
      <p className="error">{describeError(error)}</p>
    </div>
  );
}
