# STATUS — preferences (preferências alimentares)

- Estado: backend e app escritos. `npm run test:preferences` (validação, gravação idempotente, ordenação da busca, ranking puro) e `npm run test:onboarding` (prompt da IA com as listas) passam; `tsc` do backend e do app OK. NÃO verificado: IA real (Claude) usando as preferências, e o app no aparelho.
- Migration: `...019_food-preferences.sql` — `food_preferences` (id, user_id, item_key, stance `like|dislike`, updated_at, UNIQUE(user_id, item_key)). "Indiferente" = sem linha. A mesma migration amplia `profiles.onboarding_step` para 1..8 (o onboarding ganhou a etapa 6).

## Catálogo (`food-catalog.ts`)
- 150 itens em 8 categorias (proteínas, carboidratos, legumes e verduras, frutas, laticínios e ovos, bebidas, lanches e snacks, pratos brasileiros). Cada item: `key` estável em snake_case (é o que o banco guarda; não renomear), `label` (pt-BR), `category`, `searchTerms` e `taco`.
- `searchTerms`: cada termo é uma lista de palavras sem acento que devem aparecer TODAS (palavra inteira) no nome do alimento da TACO. 123 itens casam com a TACO; 27 não (`taco: false`: valem para a IA, mas não priorizam nada na busca).
- `npm run check:food-catalog` confere o campo `taco` de cada item contra a tabela `foods` (e chaves duplicadas / fora de snake_case).

## Endpoints (login)
- `GET /preferences/foods` -> `{ categories: [{key,label}], items: [{key,label,category,stance: 'like'|'dislike'|'indifferent'}] }` (não expõe `searchTerms`).
- `PUT /preferences/foods` com `{ likes: string[], dislikes: string[] }` grava o conjunto INTEIRO (apaga e reinsere numa transação; repetir é idempotente). 400 para chave fora do catálogo, item repetido ou nos dois campos, campo extra, ou lista maior que o catálogo. Resposta `{ liked, disliked }`.

## Como as preferências são usadas
- Busca de alimentos (`GET /nutrition/foods`, `listFoods`): sort estável depois do ranking normal — "gosta" primeiro, indiferente, "não gosta" por último; nenhum resultado some. Se um alimento casa com itens dos dois lados, "não gosta" vence. Sem preferências a busca não muda.
- Reconhecimento por foto (`recognition.service.ts`): os até 5 candidatos de cada alimento reconhecido seguem a mesma ordem.
- Plano da IA (`onboarding/plan-generator.ts`): o prompt traz "Gosta" e "Não gosta (não incluir)" com os labels em português e a instrução de usar os gostos e nunca incluir os que não gosta. Alimentos que casam com "não gosta" saem do catálogo enviado à IA (ela só usa o que está nele); um alimento da TACO por item "gosta" entra marcado `♥gosta` (`liked-foods.ts`). Modelo e parâmetros inalterados.
- `preferences.service.ts`: `loadPreferences`, `buildPreferences` (`rank` 0/1/2) e `sortByPreference`.

## Relacionado (Perfil > Alimentação)
- Alimentos favoritos (texto) são editados pelo `PUT /profile` com `onboarding.answers.favoriteFoods` (sem rota nova). Refeições favoritas: `PUT /nutrition/templates/:id` (ver nutrition/STATUS.md).

## Pendências
- Não verificado com a Claude real se a IA respeita a lista (o teste usa a API simulada e confere o prompt).
- A lista "Usados recentemente" da busca do app é local e não segue as preferências.
- Itens sem correspondência na TACO poderiam casar com alimentos do Open Food Facts (não avaliado).
