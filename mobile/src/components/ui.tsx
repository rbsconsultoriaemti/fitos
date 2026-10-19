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
  title: { fontSize: 28, fontWeight: '800' },
  h2: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 16 },
  muted: { fontSize: 14 },
  label: { fontSize: 13, fontWeight: '600' },
  number: { fontSize: 32, fontWeight: '800' },
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
  const bg = { primary: c.primary, secondary: c.card, danger: c.danger, ghost: 'transparent' }[kind];
  const fg = { primary: c.onPrimary, secondary: c.text, danger: '#FFFFFF', ghost: c.primary }[kind];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: kind === 'secondary' ? c.border : bg, opacity: off ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: 16, fontWeight: '700' }}>{title}</Text>}
    </Pressable>
  );
}

export function Input({ label, error, style, ...props }: TextInputProps & { label?: string; error?: string }) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space.xs }}>
      {label ? <T variant="label">{label}</T> : null}
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
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }, style]}>{children}</View>;
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: selected ? c.primary : c.card, borderColor: selected ? c.primary : c.border },
      ]}
    >
      <Text style={{ color: selected ? c.onPrimary : c.text, fontWeight: '600', fontSize: 14 }}>{label}</Text>
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
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: space.md,
    fontSize: 16,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.lg,
    gap: space.md,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
});
