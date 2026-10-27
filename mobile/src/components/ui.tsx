import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { radius, space, useColors } from '@/theme';

// ---------- texto ----------

type Variant = 'title' | 'h2' | 'body' | 'muted' | 'label' | 'number';

const textStyles: Record<Variant, TextStyle> = {
  title: { fontSize: 34, fontWeight: '700' },
  h2: { fontSize: 20, fontWeight: '600' },
  body: { fontSize: 17 },
  muted: { fontSize: 15 },
  label: { fontSize: 13, fontWeight: '600' },
  number: { fontSize: 32, fontWeight: '700' },
};

export function T({
  variant = 'body',
  style,
  children,
  numberOfLines,
}: {
  variant?: Variant;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
}) {
  const c = useColors();
  const muted = variant === 'muted' || variant === 'label';
  return (
    <Text numberOfLines={numberOfLines} style={[{ color: muted ? c.muted : c.text }, textStyles[variant], style]}>
      {children}
    </Text>
  );
}

// ---------- botões e campos ----------

export function Button({
  title,
  onPress,
  kind = 'primary',
  loading,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const bg = { primary: c.primary, secondary: c.primarySoft, danger: 'transparent', ghost: 'transparent' }[kind];
  const fg = { primary: c.onPrimary, secondary: c.primary, danger: c.danger, ghost: c.primary }[kind];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        kind === 'ghost' && styles.buttonGhost,
        { backgroundColor: bg, opacity: off ? 0.4 : pressed ? 0.6 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: 17, fontWeight: '600' }}>{title}</Text>}
    </Pressable>
  );
}

export function Input({ label, error, style, ...props }: TextInputProps & { label?: string; error?: string }) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space.xs }}>
      {label ? <Text style={{ color: c.muted, fontSize: 13 }}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={c.muted}
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        style={[
          styles.input,
          (focused || error) && { borderWidth: 1.5 },
          { color: c.text, backgroundColor: c.card, borderColor: error ? c.danger : focused ? c.primary : c.border },
          style,
        ]}
      />
      {error ? <Text style={{ color: c.danger, fontSize: 13 }}>{error}</Text> : null}
    </View>
  );
}

export function ErrorText({ children }: { children?: string | null }) {
  const c = useColors();
  if (!children) return null;
  return <Text style={{ color: c.danger, fontSize: 14 }}>{children}</Text>;
}

// ---------- blocos ----------

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[styles.card, { backgroundColor: c.card }, style]}>{children}</View>;
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? c.primary : c.card, borderColor: selected ? c.primary : c.border, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Text style={{ color: selected ? c.onPrimary : c.text, fontWeight: '600', fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

/** Barra de progresso; passou de 100% fica em âmbar (só sinaliza, não é erro). */
export function ProgressBar({ value, color, height = 8 }: { value: number; color?: string; height?: number }) {
  const c = useColors();
  const over = value > 1;
  return (
    <View style={{ height, borderRadius: height, backgroundColor: c.track, overflow: 'hidden' }}>
      <View
        style={{
          width: `${Math.min(Math.max(value, 0), 1) * 100}%`,
          height,
          borderRadius: height,
          backgroundColor: over ? c.warn : (color ?? c.primary),
        }}
      />
    </View>
  );
}

/** Divisor fino (0,5 px) entre linhas de um card agrupado. */
export function Separator({ style }: { style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }, style]} />;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={{ alignItems: 'center', padding: space.xl, gap: space.sm }}>
      <T variant="h2" style={{ textAlign: 'center' }}>
        {title}
      </T>
      {hint ? (
        <T variant="muted" style={{ textAlign: 'center' }}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  buttonGhost: {
    minHeight: 44,
  },
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    fontSize: 17,
  },
  // Card agrupado do iOS: sem sombra; a borda fica transparente para telas que a destacam com `borderColor`.
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    gap: space.md,
  },
  chip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
});
