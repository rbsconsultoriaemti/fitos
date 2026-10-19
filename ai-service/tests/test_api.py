import os

os.environ["AI_SERVICE_TOKEN"] = "secret"
os.environ["GEMINI_API_KEY"] = "fake"

from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402
from app.vision import FoodItem, Recognition  # noqa: E402

H = {"X-Service-Token": "secret"}
JPEG = ("meal.jpg", b"\xff\xd8\xff fake", "image/jpeg")
client = TestClient(main.app)


def test_requires_token():
    assert client.post("/vision/food-recognition", files={"image": JPEG}).status_code == 401
    assert client.post("/vision/food-recognition", headers={"X-Service-Token": "x"}, files={"image": JPEG}).status_code == 401


def test_rejects_non_image():
    r = client.post("/vision/food-recognition", headers=H, files={"image": ("a.txt", b"hi", "text/plain")})
    assert r.status_code == 415


def test_rejects_too_large(monkeypatch):
    monkeypatch.setattr(main.settings, "max_image_bytes", 4)
    r = client.post("/vision/food-recognition", headers=H, files={"image": JPEG})
    assert r.status_code == 413


def test_returns_items(monkeypatch):
    fake = Recognition(items=[FoodItem(name="arroz branco cozido", estimated_grams=150, confidence=0.9)])
    monkeypatch.setattr(main, "recognize_food", lambda c, d, m: fake)
    r = client.post("/vision/food-recognition", headers=H, files={"image": JPEG})
    assert r.status_code == 200
    assert r.json()["items"][0]["name"] == "arroz branco cozido"


def test_provider_failure_is_502(monkeypatch):
    def boom(*a):
        raise RuntimeError("quota")

    monkeypatch.setattr(main, "recognize_food", boom)
    r = client.post("/vision/food-recognition", headers=H, files={"image": JPEG})
    assert r.status_code == 502
