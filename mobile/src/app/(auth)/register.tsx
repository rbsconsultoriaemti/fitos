import { Link } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AuthScreen } from '@/components/auth-screen';
import { Button, ErrorText, Input, T } from '@/components/ui';
import { errorMessage } from '@/lib/dialog';
import { useSession } from '@/session';
import { space, useColors } from '@/theme';

export default function Register() {
  const { signUp } = useSession();
  const c = useColors();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = 'Informe seu nome.';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'E-mail inválido.';
    if (password.length < 8) next.password = 'A senha precisa ter ao menos 8 caracteres.';
    setErrors(next);
    setError(null);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    try {
      await signUp(name.trim(), email.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  };

  return (
    <AuthScreen title="Criar conta" subtitle="Cadastre-se para registrar treinos e refeições.">
      <View style={{ gap: space.lg }}>
        <Input label="Nome" value={name} onChangeText={setName} autoComplete="name" textContentType="name" error={errors.name} />
        <Input
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          error={errors.email}
        />
        <Input
          label="Senha"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={submit}
          error={errors.password}
        />
        <ErrorText>{error}</ErrorText>
        <Button title="Criar conta" onPress={submit} loading={loading} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
        <T variant="muted">Já tem conta?</T>
        <Link href="/login" style={{ color: c.primary, fontWeight: '700' }}>
          Entrar
        </Link>
      </View>
    </AuthScreen>
  );
}
