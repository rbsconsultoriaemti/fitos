import base64

from anthropic import Anthropic
from pydantic import BaseModel, Field

from .config import settings

PROMPT = """Você analisa fotos de refeições para um app de nutrição brasileiro.
Identifique cada alimento distinto visível no prato, estime a quantidade de cada um em gramas e os macronutrientes dessa quantidade.

Regras:
- Use nomes genéricos em português do Brasil, como na Tabela TACO (ex.: "arroz branco cozido", "feijão carioca cozido", "peito de frango grelhado", "ovo de galinha frito").
- Estime o peso da porção que aparece na foto, não de uma porção padrão. Use como referência o tamanho do prato, talheres e mãos, quando visíveis.
- kcal, protein_g, carb_g e fat_g são os valores da quantidade estimada (quantity_g), não de 100 g.
- Para os macros, parta dos valores da Tabela TACO para o alimento quando você os conhecer; se não conhecer, estime a partir dos macros usuais do alimento.
- confidence é de 0 a 1 e reflete sua certeza de que o alimento foi identificado corretamente.
- Se a foto não contiver comida, devolva a lista vazia.
- Não dê conselhos de saúde nem opine sobre a refeição; apenas identifique e estime."""

TOOL_NAME = "registrar_refeicao"


class FoodItem(BaseModel):
    name: str = Field(description="Nome do alimento em português do Brasil")
    quantity_g: float = Field(description="Peso estimado da porção, em gramas", gt=0, le=3000)
    kcal: float = Field(description="Calorias da porção estimada", ge=0, le=6000)
    protein_g: float = Field(description="Proteína da porção estimada, em gramas", ge=0, le=500)
    carb_g: float = Field(description="Carboidrato da porção estimada, em gramas", ge=0, le=1000)
    fat_g: float = Field(description="Gordura da porção estimada, em gramas", ge=0, le=500)
    confidence: float = Field(description="Confiança de 0 a 1", ge=0, le=1)


class Recognition(BaseModel):
    foods: list[FoodItem]


def make_client() -> Anthropic:
    # Abaixo do timeout de 30 s do backend, para a falha chegar como 502 em vez de estourar lá.
    return Anthropic(api_key=settings.anthropic_api_key, timeout=25.0, max_retries=1)


def recognize_food(client: Anthropic, image: bytes, mime_type: str) -> Recognition:
    # Tool use forçado: o modelo só pode responder chamando a ferramenta, então a saída é sempre JSON no schema.
    response = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=2048,
        temperature=0.2,
        tools=[
            {
                "name": TOOL_NAME,
                "description": "Registra os alimentos identificados na foto, com quantidade e macros estimados.",
                "input_schema": Recognition.model_json_schema(),
            }
        ],
        tool_choice={"type": "tool", "name": TOOL_NAME},
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime_type,
                            "data": base64.standard_b64encode(image).decode("ascii"),
                        },
                    },
                    {"type": "text", "text": PROMPT},
                ],
            }
        ],
    )
    for block in response.content:
        if block.type == "tool_use" and block.name == TOOL_NAME:
            return Recognition.model_validate(block.input)
    raise ValueError(f"resposta sem {TOOL_NAME} (stop_reason={response.stop_reason})")
