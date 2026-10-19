import { View } from 'react-native';

import { Card, ProgressBar, T } from '@/components/ui';
import { fmt0, fmt1 } from '@/lib/format';
import type { DayLog } from '@/lib/types';
import { useColors } from '@/theme';

/** Resumo do dia: kcal e macros consumidos × meta (quando existe plano ativo com metas). */
export function DaySummary({ day }: { day: DayLog }) {
  const c = useColors();
  const kcal = day.progress?.kcal;

  const macros = [
    { label: 'Proteína', key: 'proteinG', value: day.totals.proteinG, color: c.protein },
    { label: 'Carboidrato', key: 'carbG', value: day.totals.carbG, color: c.carb },
    { label: 'Gordura', key: 'fatG', value: day.totals.fatG, color: c.fat },
  ] as const;

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <T variant="number">{fmt0(day.totals.kcal)}</T>
          <T variant="muted">{kcal ? `/ ${fmt0(kcal.target)} kcal` : 'kcal'}</T>
        </View>
        {kcal ? (
          <T variant="label" style={{ color: kcal.remaining < 0 ? c.warn : c.muted }}>
            {kcal.remaining >= 0 ? `faltam ${fmt0(kcal.remaining)}` : `passou ${fmt0(-kcal.remaining)}`}
          </T>
        ) : null}
      </View>
      {kcal ? <ProgressBar value={kcal.consumed / kcal.target} /> : <T variant="muted">Sem meta de calorias definida.</T>}

      <View style={{ gap: 10, marginTop: 4 }}>
        {macros.map((m) => {
          const p = day.progress?.[m.key];
          return (
            <View key={m.key} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T variant="label">{m.label}</T>
                <T variant="label">{p ? `${fmt1(m.value)} / ${fmt0(p.target)} g` : `${fmt1(m.value)} g`}</T>
              </View>
              {p ? <ProgressBar value={p.consumed / p.target} color={m.color} height={6} /> : null}
            </View>
          );
        })}
      </View>
    </Card>
  );
}
