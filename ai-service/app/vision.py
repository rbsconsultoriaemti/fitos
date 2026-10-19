from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from .config import settings

PROMPT = """Você analisa fotos de refeições para um app de nutrição brasileiro.
Identifique cada alimento distinto visível no prato e estime a quantidade de cada um em gramas.

Regras:
- Use nomes genéricos em português do Brasil, como na Tabela TACO (ex.: "arroz branco cozido", "feijão carioca cozido", "peito de frango grelhado", "ovo de galinha frito").
- Estime o peso da porção que aparece na foto, não de uma porção padrão.
- confidence é de 0 a 1 e reflete sua certeza de que o alimento foi identificado corretamente.
- Se a foto não contiver comida, devolva a lista vazia.
- Não dê conselhos de saúde nem opine sobre a refeição; apenas identifique e estime."""


class FoodItem(BaseModel):
    name: str = Field(description="Nome do alimento em português do Brasil")
    estimated_grams: float = Field(description="Peso estimado da porção, em gramas", gt=0, le=3000)
    confidence: float = Field(description="Confiança de 0 a 1", ge=0, le=1)


class Recognition(BaseModel):
    items: list[FoodItem]


def make_client() -> genai.Client:
    return genai.Client(api_key=settings.gemini_api_key)


def recognize_food(client: genai.Client, image: bytes, mime_type: str) -> Recognition:
    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=[types.Part.from_bytes(data=image, mime_type=mime_type), PROMPT],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=Recognition,
            temperature=0.2,
        ),
    )
    return Recognition.model_validate_json(response.text)
