import { Input } from '@/components/ui';

/** Campo de "alimentos favoritos" (texto separado por vírgula), igual no onboarding e no Perfil. */
export function FavoriteFoodsField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Input
      label="Quais alimentos você mais gosta? (opcional)"
      value={value}
      onChangeText={onChange}
      placeholder="Ex.: arroz, feijão, frango grelhado, ovo cozido"
      multiline
      maxLength={300}
    />
  );
}
