# STATUS — ai-service

- Estado: serviço FastAPI com reconhecimento de alimentos por foto (Gemini Vision). 5 testes pytest passam (Gemini mockado). **Nunca chamou o Gemini de verdade** (sem chave).

## Rodar
```
cd ai-service
python -m venv .venv && .venv\Scripts\pip install -r requirements.txt
copy .env.example .env   # preencher GEMINI_API_KEY e AI_SERVICE_TOKEN
.venv\Scripts\uvicorn app.main:app --port 8000
.venv\Scripts\python -m pytest -q
```
O `.env` não é carregado automaticamente: exporte as variáveis (ou rode via Railway) antes do uvicorn.

## Endpoints
- `GET /health`
- `POST /vision/food-recognition` — multipart `image` (jpeg/png/webp, ≤ `MAX_IMAGE_BYTES`, 8 MB), header `X-Service-Token`. Devolve `{ items: [{ name, estimated_grams, confidence }] }` com nomes em português do Brasil no estilo TACO. Erros: 401 token, 413/415 imagem, 503 sem chave, 502 falha do Gemini.

## Decisões
- Saída estruturada via `response_schema` (Pydantic) com `generate_content` do SDK `google-genai`; o prompt só identifica e estima, sem opinar sobre saúde.
- Sem `AI_SERVICE_TOKEN` configurado o serviço recusa tudo (não fica aberto por engano).
- Quem casa os nomes com a base TACO é o backend (`recognition.service.ts`), não este serviço.

## Pendente
- **Validar com chave real**: o modelo padrão `gemini-3.8-flash` veio dos exemplos da documentação do Gemini (image-understanding) e não pude confirmar que o id existe/está disponível para a sua conta; é configurável por `GEMINI_MODEL`. A página também mostra uma API nova (`client.interactions.create`); usei `generate_content`, que o SDK instalado também tem.
- Medir qualidade das estimativas de gramas com fotos reais de pratos brasileiros
- Carregar `.env` (python-dotenv) e Dockerfile/Procfile para o deploy no Railway
- Microserviço de texto (Claude API: treino/dieta) — ainda não iniciado
