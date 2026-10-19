import os


class Settings:
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
    service_token: str = os.getenv("AI_SERVICE_TOKEN", "")
    max_image_bytes: int = int(os.getenv("MAX_IMAGE_BYTES", str(8 * 1024 * 1024)))


settings = Settings()
