# STATUS — ai-service

- Estado: serviço FastAPI com reconhecimento de alimentos por foto (Claude Vision, Anthropic SDK). Testes pytest com SDK mockado (última contagem registrada: 10; não reexecutados nesta atualização). Roda em container na VPS; a chave `ANTHROPIC_API_KEY` já está configurada no backend da VPS, mas **a chamada real à Claude Vision ainda não foi confirmada** neste repositório.
- Mudanças recentes: removido o parâmetro `temperature` da chamada `messages.create()` (a API recusava); novo campo opcional `hints` (ingredientes informados pelo usuário).

## Rodar
```
cd ai-service
python -m venv .venv && .venv\Scripts\pip install -r requirements.txt
copy .env.example .env   # preencher ANTHROPIC_API_KEY e AI_SERVICE_TOKEN
.venv\Scripts\uvicorn app.main:app --port 8000
.venv\Scripts\python -m pytest -q
```
O `.env` não é carregado automaticamente: exporte as variáveis antes do uvicorn (em produção o container recebe as variáveis do compose da VPS; não verificado).

## Endpoints
- `GET /health`
- `POST /vision/food-recognition` — multipart `image` (jpeg/png/webp, ≤ `MAX_IMAGE_BYTES`, 8 MB) e `hints` opcional (texto livre, ex.: "frango, arroz"; reduzido a uma linha e cortado em 200 caracteres), header `X-Service-Token`. Com `hints`, o prompt ganha: "O usuário informou que o prato contém: … Use essa informação para identificar os alimentos com mais precisão, mas também identifique outros alimentos visíveis na foto."; sem `hints`, o prompt é o de sempre. Devolve `{ foods: [{ name, quantity_g, kcal, protein_g, carb_g, fat_g, confidence }] }` com nomes em português do Brasil no estilo TACO; os macros são da porção estimada, não de 100 g. Erros: 401 token, 413/415 imagem, 503 sem chave, 502 falha da API.

## Decisões
- Modelo `claude-opus-4-5` (configurável por `ANTHROPIC_MODEL`). A foto vai em base64 num bloco `image` da Messages API.
- Saída estruturada por tool use forçado (`tool_choice` na ferramenta `registrar_refeicao`, `input_schema` gerado do Pydantic): o modelo só responde chamando a ferramenta, então o JSON sempre bate com o schema.
- O Claude estima porção e macros (partindo dos valores da TACO que conhece); quem casa os nomes com a base TACO real é o backend (`recognition.service.ts`), que devolve até 5 candidatos e mantém os macros do Claude como fallback.
- Chamada ao SDK síncrona roda em thread (`run_in_threadpool`); timeout de 25 s, abaixo dos 30 s do backend.
- Sem `AI_SERVICE_TOKEN` configurado o serviço recusa tudo (não fica aberto por engano).

## Pendente
- Troca de modelo `claude-opus-4-5` → `claude-haiku-5-5` (custo) decidida em CLAUDE.md, mas só depois de comparar a qualidade em fotos reais; o modelo atual segue sendo `claude-opus-4-5`
- **Validar com chave real** (`ANTHROPIC_API_KEY`): só testei com o SDK mockado; confirmar que o id `claude-opus-4-5` está disponível na sua conta e medir custo/latência por foto
- Medir qualidade das estimativas de gramas com fotos reais de pratos brasileiros
- Carregar `.env` automaticamente (python-dotenv não está em `requirements.txt`). O `Dockerfile` já existe (python 3.12-slim, usuário sem root, healthcheck em `/health`); o serviço roda como container `fitos-ai-service-1` na VPS
- Microserviço de texto (Claude API: treino/dieta) — ainda não iniciado
