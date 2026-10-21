import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';

import { Button, Card, ErrorText, Input, T } from '@/components/ui';
import { fmt0 } from '@/lib/format';
import type { MealTemplate } from '@/lib/types';
import { radius, space, useColors } from '@/theme';

function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const c = useColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: space.lg }}
      >
        <View style={{ backgroundColor: c.card, borderRadius: radius.lg, padding: space.lg, gap: space.md, maxHeight: '85%' }}>{children}</View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Pede o nome para salvar a refeição do dia como favorita. */
export function SaveFavoriteModal({
  visible,
  mealLabel,
  itemCount,
  kcal,
  onSave,
  onClose,
}: {
  visible: boolean;
  mealLabel: string;
  itemCount: number;
  kcal: number;
  onSave: (name: string) => Promise<string | null>; // devolve a mensagem de erro, ou null se salvou
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (name.trim().length === 0) {
      setError('Dê um nome para a favorita.');
      return;
    }
    setSaving(true);
    const err = await onSave(name.trim());
    setSaving(false);
    if (err) setError(err);
    else {
      setName('');
      setError(null);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose}>
      <T variant="h2">Salvar como favorita</T>
      <T variant="muted">{`${mealLabel}: ${itemCount} ${itemCount === 1 ? 'alimento' : 'alimentos'} · ${fmt0(kcal)} kcal`}</T>
      <Input label="Nome" value={name} onChangeText={setName} placeholder="Ex.: Café da manhã de treino" autoFocus maxLength={80} />
      <ErrorText>{error}</ErrorText>
      <Button title="Salvar" onPress={submit} loading={saving} />
      <Button title="Cancelar" kind="ghost" onPress={onClose} />
    </Sheet>
  );
}

/** Lista as favoritas; tocar em uma registra todos os alimentos de uma vez na refeição escolhida. */
export function ApplyFavoriteModal({
  visible,
  mealLabel,
  templates,
  offline,
  onApply,
  onDelete,
  onClose,
}: {
  visible: boolean;
  mealLabel: string;
  templates: MealTemplate[];
  offline: boolean;
  onApply: (t: MealTemplate) => Promise<string | null>;
  onDelete: (t: MealTemplate) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function apply(t: MealTemplate) {
    setBusy(t.id);
    setError(null);
    const err = await onApply(t);
    setBusy(null);
    if (err) setError(err);
  }

  return (
    <Sheet visible={visible} onClose={onClose}>
      <T variant="h2">{`Favoritas · ${mealLabel}`}</T>
      {offline ? <T variant="muted">Sem conexão: mostrando as favoritas salvas no aparelho.</T> : null}
      <ErrorText>{error}</ErrorText>
      <ScrollView contentContainerStyle={{ gap: space.sm }}>
        {templates.length === 0 ? (
          <T variant="muted">Você ainda não tem refeições favoritas. Registre uma refeição e toque em "Salvar como favorita".</T>
        ) : null}
        {templates.map((t) => (
          <Pressable key={t.id} disabled={busy !== null} onPress={() => apply(t)} accessibilityRole="button">
            <Card style={{ gap: 2, opacity: busy && busy !== t.id ? 0.5 : 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
                <T variant="h2" style={{ flex: 1 }}>
                  {t.name}
                </T>
                <T variant="label">{`${fmt0(t.totals.kcal)} kcal`}</T>
              </View>
              <T variant="muted">{t.items.map((i) => i.name.split(',')[0]).join(' · ')}</T>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <T variant="label">{busy === t.id ? 'Adicionando…' : 'Toque para adicionar tudo'}</T>
                <Button title="Excluir" kind="ghost" disabled={busy !== null || offline} onPress={() => onDelete(t)} />
              </View>
            </Card>
          </Pressable>
        ))}
      </ScrollView>
      <Button title="Fechar" kind="secondary" onPress={onClose} />
    </Sheet>
  );
}
