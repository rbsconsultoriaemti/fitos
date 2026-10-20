import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';

import { T } from '@/components/ui';
import { radius, space, useColors } from '@/theme';

// Demonstração do exercício: os 2 quadros do movimento alternam sozinhos (efeito de animação).
// Toque para ampliar. As imagens ficam em cache no disco para funcionar sem sinal depois de vistas uma vez.

function Frames({ urls, size }: { urls: string[]; size: number }) {
  const c = useColors();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (urls.length < 2) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % urls.length), 900);
    return () => clearInterval(timer);
  }, [urls.length]);

  return (
    <Image
      source={{ uri: urls[frame % urls.length] }}
      cachePolicy="disk"
      contentFit="contain"
      transition={150}
      style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: c.card }}
    />
  );
}

export function ExerciseMedia({ urls, name }: { urls: string[] | undefined; name: string }) {
  const [open, setOpen] = useState(false);
  if (!urls || urls.length === 0) return null;

  return (
    <>
      <Pressable accessibilityRole="imagebutton" accessibilityLabel={`Ampliar demonstração: ${name}`} onPress={() => setOpen(true)}>
        <Frames urls={urls} size={96} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: space.lg, gap: space.md }}
        >
          <View style={{ borderRadius: radius.lg, overflow: 'hidden' }}>
            <Frames urls={urls} size={320} />
          </View>
          <T variant="h2" style={{ color: '#FFFFFF' }}>
            {name}
          </T>
          <T variant="muted" style={{ color: '#FFFFFF' }}>
            Toque para fechar
          </T>
        </Pressable>
      </Modal>
    </>
  );
}
