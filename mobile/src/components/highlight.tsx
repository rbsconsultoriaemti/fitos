import { Text, type TextStyle } from 'react-native';

import { T } from '@/components/ui';
import { normalize } from '@/lib/format';
import { useColors } from '@/theme';

// Normaliza caractere a caractere (sem acento, minúsculas) para manter o mesmo comprimento do texto original.
const fold = (ch: string) => normalize(ch).charAt(0) || ch;

/** Destaca no texto os trechos que casam com as palavras buscadas (ignora acento e caixa). */
export function Highlight({ text, query, variant = 'body' }: { text: string; query: string; variant?: 'body' | 'muted' }) {
  const c = useColors();
  const tokens = normalize(query)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return <T variant={variant}>{text}</T>;

  const folded = Array.from(text, fold).join('');
  const marked = new Array<boolean>(text.length).fill(false);
  if (folded.length === text.length) {
    for (const token of tokens) {
      for (let i = folded.indexOf(token); i >= 0; i = folded.indexOf(token, i + 1)) {
        for (let k = i; k < i + token.length; k++) marked[k] = true;
      }
    }
  }

  // Agrupa caracteres consecutivos com a mesma marcação.
  const parts: { text: string; on: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.on === marked[i]) last.text += text[i];
    else parts.push({ text: text[i], on: marked[i] });
  }

  const highlight: TextStyle = { fontWeight: '800', color: c.primary };
  return (
    <T variant={variant}>
      {parts.map((p, i) => (
        <Text key={i} style={p.on ? highlight : undefined}>
          {p.text}
        </Text>
      ))}
    </T>
  );
}
