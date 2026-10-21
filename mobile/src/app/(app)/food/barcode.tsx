import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button, ErrorText, Input, T } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/dialog';
import { findFoodByBarcode, isOffline, rememberFood } from '@/lib/offline';
import { radius, space, useColors } from '@/theme';

export default function Barcode() {
  const c = useColors();
  const { meal, date } = useLocalSearchParams<{ meal?: string; date?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false); // a câmera dispara várias leituras do mesmo código

  async function lookup(code: string) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      const food = await findFoodByBarcode(code);
      await rememberFood(food);
      router.replace(`/food/quantity?foodId=${food.id}&meal=${meal ?? ''}&date=${date ?? ''}` as never);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError(`Produto ${code} não encontrado (ou sem informações nutricionais completas). Busque pelo nome.`);
      } else if (isOffline(err)) {
        setError('Sem conexão: só encontro produtos que você já usou neste aparelho.');
      } else {
        setError(errorMessage(err));
      }
      locked.current = false;
      setBusy(false);
    }
  }

  const submitManual = () => {
    const code = manual.replace(/\D/g, '');
    if (code.length < 8 || code.length > 14) {
      setError('O código de barras tem de 8 a 14 números.');
      return;
    }
    lookup(code);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }} keyboardShouldPersistTaps="handled">
      {!permission ? (
        <T variant="muted">Verificando a câmera…</T>
      ) : permission.granted ? (
        <View style={{ height: 280, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: c.card }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
            onBarcodeScanned={busy ? undefined : ({ data }) => lookup(data)}
          />
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <T variant="muted">Permita o uso da câmera para ler o código de barras, ou digite o código abaixo.</T>
          <Button title="Permitir câmera" onPress={requestPermission} />
        </View>
      )}

      {busy ? <T variant="muted">Buscando produto…</T> : <T variant="muted">Aponte a câmera para o código de barras da embalagem.</T>}
      <ErrorText>{error}</ErrorText>

      <View style={{ gap: space.sm }}>
        <Input
          label="Ou digite o código"
          value={manual}
          onChangeText={setManual}
          keyboardType="number-pad"
          placeholder="7891000100103"
          maxLength={14}
        />
        <Button title="Buscar código" kind="secondary" onPress={submitManual} disabled={busy} />
      </View>
    </ScrollView>
  );
}
