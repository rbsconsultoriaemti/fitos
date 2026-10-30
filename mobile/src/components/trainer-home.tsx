import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, Share, View } from 'react-native';

import { Button, Card, ErrorText, Input, Separator, T } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage, notify } from '@/lib/dialog';
import { initialOf, normalize } from '@/lib/format';
import type { TodayStatus, TrainerStudentItem, TrainerStudents } from '@/lib/types';
import { useSession } from '@/session';
import { space, useColors } from '@/theme';

/** Cor e texto do selo do dia: verde treinou, amarelo tem treino e não fez, cinza descanso/sem plano. */
export function useStatusStyle() {
  const c = useColors();
  return (status: TodayStatus) =>
    ({
      trained: { color: c.primary, label: 'Treinou hoje' },
      pending: { color: c.warn, label: 'Falta treinar' },
      rest: { color: c.muted, label: 'Descanso' },
      no_plan: { color: c.muted, label: 'Sem plano' },
    })[status];
}

export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const c = useColors();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
      <T variant="h2" style={{ color: c.primary, fontSize: size * 0.42 }}>
        {initialOf(name)}
      </T>
    </View>
  );
}

export function StatusBadge({ status }: { status: TodayStatus }) {
  const style = useStatusStyle()(status);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: style.color }} />
      <T variant="label" style={{ color: style.color }}>
        {style.label}
      </T>
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <T variant="number">{value}</T>
      <T variant="label" style={{ textAlign: 'center' }}>
        {label}
      </T>
    </View>
  );
}

/** Home do professor: resumo, convite, busca e a lista de alunos com o status de hoje. */
export function TrainerHome() {
  const c = useColors();
  const { user } = useSession();
  const [data, setData] = useState<TrainerStudents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<TrainerStudents>('/trainer/students'));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  async function invite() {
    setInviting(true);
    try {
      const { link } = await api<{ link: string }>('/invites/generate', { method: 'POST' });
      await Share.share({
        message: `${user?.name.split(' ')[0] ?? 'Seu professor'} convidou você para treinar pelo FitOS. Instale o app e abra este link para se vincular (vale por 7 dias):\n${link}`,
      });
    } catch (err) {
      notify('Não foi possível gerar o convite', errorMessage(err));
    } finally {
      setInviting(false);
    }
  }

  const students = useMemo(() => {
    const q = normalize(query.trim());
    return (data?.students ?? []).filter((s) => !q || normalize(s.name).includes(q));
  }, [data, query]);

  const status = useStatusStyle();
  const subtitle = (s: TrainerStudentItem) =>
    s.streak >= 1 ? `${s.streak} ${s.streak === 1 ? 'treino seguido' : 'treinos seguidos'}` : (s.goal ?? 'Sem objetivo informado');

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.lg, maxWidth: 640, width: '100%', alignSelf: 'center' }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Image source={require('../../assets/images/splash-icon.png')} style={{ width: 40, height: 37 }} resizeMode="contain" accessibilityLabel="Logo FitOS" />
        <View style={{ gap: 2, flex: 1 }}>
          <T variant="title">Olá, {user?.name.split(' ')[0]}</T>
          <T variant="muted">Seus alunos hoje</T>
        </View>
      </View>

      <ErrorText>{error}</ErrorText>

      <Card style={{ flexDirection: 'row', gap: space.sm }}>
        <Stat value={data?.summary.total ?? 0} label="Alunos" />
        <Stat value={data?.summary.trainedToday ?? 0} label="Treinaram hoje" />
        <Stat value={data?.summary.onStreak ?? 0} label={`Em sequência (${data?.summary.streakMin ?? 3}+ treinos)`} />
      </Card>

      <Button title="Convidar aluno" onPress={invite} loading={inviting} />

      {data && data.students.length > 0 ? (
        <Input placeholder="Buscar aluno por nome" value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} />
      ) : null}

      {!data && !error ? <T variant="muted">Carregando…</T> : null}

      {data && data.students.length === 0 ? (
        <Card style={{ gap: space.xs }}>
          <T variant="h2">Nenhum aluno ainda</T>
          <T variant="muted">Toque em “Convidar aluno” e envie o link. Quando o aluno aceitar, ele aparece aqui com o treino de hoje.</T>
        </Card>
      ) : null}

      {data && data.students.length > 0 && students.length === 0 ? <T variant="muted">Nenhum aluno com esse nome.</T> : null}

      {students.length > 0 ? (
        <Card style={{ paddingHorizontal: 0, paddingVertical: 0, gap: 0, overflow: 'hidden' }}>
          {students.map((s, i) => (
            <View key={s.id}>
              {i > 0 ? <Separator style={{ marginLeft: space.lg }} /> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={`${s.name}, ${status(s.todayStatus).label}`} onPress={() => router.push(`/trainer/student/${s.id}` as never)}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, opacity: pressed ? 0.6 : 1 })}
              >
                <Avatar name={s.name} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T variant="h2" numberOfLines={1}>
                    {s.name}
                  </T>
                  <T variant="muted" numberOfLines={1}>
                    {subtitle(s)}
                  </T>
                  <StatusBadge status={s.todayStatus} />
                </View>
                <Ionicons name="chevron-forward" size={20} color={c.muted} />
              </Pressable>
            </View>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}
