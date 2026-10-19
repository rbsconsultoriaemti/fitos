import { Link } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AuthScreen } from '@/components/auth-screen';
import { Button, ErrorText, Input, T } from '@/components/ui';
import { errorMessage } from '@/lib/dialog';
import { useSession } from '@/session';
import { space, useColors } from '@/theme';

export default function Login() {
  const { signIn } = useSession();
  const c = useColors();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) return setError('Informe e-mail e senha.');
    setLoading(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  };

  return (
    <AuthScreen title="Entrar" subtitle="Acesse seus treinos e sua alimentação.">
      <View style={{ gap: space.lg }}>
        <Input
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
        />
        <Input
          label="Senha"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <ErrorText>{error}</ErrorText>
        <Button title="Entrar" onPress={submit} loading={loading} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
        <T variant="muted">Ainda não tem conta?</T>
        <Link href="/register" style={{ color: c.primary, fontWeight: '700' }}>
          Cadastre-se
        </Link>
      </View>
    </AuthScreen>
  );
}
