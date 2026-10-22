import hmac
import logging

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from .config import settings
from .vision import Recognition, make_client, recognize_food

log = logging.getLogger("ai-service")
app = FastAPI(title="FitOS AI Service")

ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}


def require_service_token(x_service_token: str = Header(default="")) -> None:
    # Sem token configurado o serviço recusa tudo, em vez de ficar aberto por engano.
    if not settings.service_token or not hmac.compare_digest(x_service_token, settings.service_token):
        raise HTTPException(status_code=401, detail="invalid_service_token")


def get_client():
    return make_client()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/vision/food-recognition", response_model=Recognition, dependencies=[Depends(require_service_token)])
async def food_recognition(image: UploadFile = File(...), hints: str = Form(default=""), client=Depends(get_client)):
    if image.content_type not in ALLOWED_MIME:
        raise HTTPException(status_code=415, detail="unsupported_image_type")
    data = await image.read(settings.max_image_bytes + 1)
    if len(data) > settings.max_image_bytes:
        raise HTTPException(status_code=413, detail="image_too_large")
    if not data:
        raise HTTPException(status_code=400, detail="empty_image")
    if not settings.anthropic_api_key:
        raise HTTPException(status_code=503, detail="anthropic_not_configured")
    try:
        # A chamada ao SDK é síncrona: roda em thread para não travar o event loop.
        return await run_in_threadpool(recognize_food, client, data, image.content_type, hints)
    except Exception:
        log.exception("Falha ao consultar o Claude")
        raise HTTPException(status_code=502, detail="vision_provider_error")
