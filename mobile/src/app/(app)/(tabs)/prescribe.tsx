import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Avatar } from '@/components/trainer-home';
import { Card, ErrorText, Input, Separator, T } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/dialog';
import { normalize } from '@/lib/format';
import type { TrainerStudents } from '@/lib/types';
import { space, useColors } from '@/theme';

/** Aba "Prescrever" do professor: escolhe o aluno e abre a prescrição. */
export default function PrescribeTab() {
  const c = useColors();
  const [data, setData] = useState<TrainerStudents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

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

  const students = useMemo(() => {
    const q = normalize(query.trim());
    return (data?.students ?? []).filter((s) => !q || normalize(s.name).includes(q));
  }, [data, query]);

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: space.lg, gap: space.md, maxWidth: 640, width: '100%', alignSelf: 'center' }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <T variant="muted">Para quem você quer prescrever?</T>
      <ErrorText>{error}</ErrorText>
      {data && data.students.length > 0 ? <Input placeholder="Buscar aluno por nome" value={query} onChangeText={setQuery} autoCorrect={false} /> : null}
      {data && data.students.length === 0 ? <T variant="muted">Você ainda não tem alunos. Convide alunos pela aba Início.</T> : null}
      {data && data.students.length > 0 && students.length === 0 ? <T variant="muted">Nenhum aluno com esse nome.</T> : null}
      {students.length > 0 ? (
        <Card style={{ paddingHorizontal: 0, paddingVertical: 0, gap: 0, overflow: 'hidden' }}>
          {students.map((s, i) => (
            <View key={s.id}>
              {i > 0 ? <Separator style={{ marginLeft: space.lg }} /> : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/trainer/prescribe/${s.id}` as never)}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, opacity: pressed ? 0.6 : 1 })}
              >
                <Avatar name={s.name} />
                <T variant="h2" style={{ flex: 1 }} numberOfLines={1}>
                  {s.name}
                </T>
                <Ionicons name="chevron-forward" size={20} color={c.muted} />
              </Pressable>
            </View>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}
