import os


class Settings:
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-opus-4-5")
    service_token: str = os.getenv("AI_SERVICE_TOKEN", "")
    max_image_bytes: int = int(os.getenv("MAX_IMAGE_BYTES", str(8 * 1024 * 1024)))


settings = Settings()
