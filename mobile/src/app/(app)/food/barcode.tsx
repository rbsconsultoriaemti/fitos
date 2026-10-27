import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ErrorText, Input, T } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/dialog';
import { findFoodByBarcode, isOffline, rememberFood } from '@/lib/offline';
import { radius, space, useColors } from '@/theme';

export default function Barcode() {
  const insets = useSafeAreaInsets();
  const c = useColors();
  const { meal, date } = useLocalSearchParams<{ meal?: string; date?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedCode, setFailedCode] = useState<string | null>(null); // leitura que não deu certo: a câmera fica parada até a pessoa pedir outra
  const [cameraError, setCameraError] = useState<string | null>(null);
  const locked = useRef(false); // a câmera dispara várias leituras do mesmo código

  async function lookup(code: string) {
    if (locked.current) return;
    // Só dígitos, 8 a 14: qualquer outra leitura (QR code, texto) é descartada sem consultar a API.
    if (!/^\d{8,14}$/.test(code)) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setFailedCode(null);
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
      // Mantém locked/busy: sem isso a câmera relê o mesmo código em loop, repetindo a consulta e piscando o erro.
      setFailedCode(code);
    }
  }

  function scanAgain() {
    locked.current = false;
    setBusy(false);
    setError(null);
    setFailedCode(null);
  }

  const submitManual = () => {
    const code = manual.replace(/\D/g, '');
    if (code.length < 8 || code.length > 14) {
      setError('O código de barras tem de 8 a 14 números.');
      return;
    }
    if (failedCode) scanAgain();
    lookup(code);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.lg }} keyboardShouldPersistTaps="handled">
      {!permission ? (
        <T variant="muted">Verificando a câmera…</T>
      ) : permission.granted ? (
        <View style={{ height: 280, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: c.card }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
            onBarcodeScanned={busy ? undefined : ({ data }) => lookup(data.trim())}
            onMountError={({ message }) => setCameraError(message || 'Não consegui abrir a câmera.')}
          />
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <T variant="muted">Permita o uso da câmera para ler o código de barras, ou digite o código abaixo.</T>
          {permission.canAskAgain ? (
            <Button title="Permitir câmera" onPress={requestPermission} />
          ) : (
            <Button title="Abrir configurações do aparelho" onPress={() => Linking.openSettings()} />
          )}
        </View>
      )}

      {busy && !failedCode ? (
        <T variant="muted">Buscando produto…</T>
      ) : failedCode ? null : (
        <T variant="muted">Aponte a câmera para o código de barras da embalagem.</T>
      )}
      <ErrorText>{cameraError ? `${cameraError} Digite o código abaixo.` : error}</ErrorText>
      {failedCode ? (
        <View style={{ gap: space.sm }}>
          <Button title="Ler outro código" onPress={scanAgain} />
          <Button title="Buscar pelo nome" kind="secondary" onPress={() => router.back()} />
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Input
          label="Ou digite o código"
          value={manual}
          onChangeText={setManual}
          keyboardType="number-pad"
          placeholder="7891000100103"
          maxLength={14}
        />
        <Button title="Buscar código" kind="secondary" onPress={submitManual} disabled={busy && !failedCode} />
      </View>
    </ScrollView>
  );
}
