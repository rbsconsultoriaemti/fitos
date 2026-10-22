import os

os.environ["AI_SERVICE_TOKEN"] = "secret"
os.environ["ANTHROPIC_API_KEY"] = "fake"

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
    fake = Recognition(
        foods=[FoodItem(name="arroz branco cozido", quantity_g=150, kcal=192, protein_g=3.8, carb_g=41.9, fat_g=0.3, confidence=0.9)]
    )
    monkeypatch.setattr(main, "recognize_food", lambda c, d, m, h="": fake)
    r = client.post("/vision/food-recognition", headers=H, files={"image": JPEG})
    assert r.status_code == 200
    assert r.json()["foods"][0]["name"] == "arroz branco cozido"


def test_provider_failure_is_502(monkeypatch):
    def boom(*a):
        raise RuntimeError("quota")

    monkeypatch.setattr(main, "recognize_food", boom)
    r = client.post("/vision/food-recognition", headers=H, files={"image": JPEG})
    assert r.status_code == 502


def test_provider_not_configured_is_503(monkeypatch):
    monkeypatch.setattr(main.settings, "anthropic_api_key", "")
    r = client.post("/vision/food-recognition", headers=H, files={"image": JPEG})
    assert r.status_code == 503


def test_recognize_food_sends_base64_image_and_parses_tool_output():
    from types import SimpleNamespace

    from app import vision

    calls = {}

    def create(**kwargs):
        calls.update(kwargs)
        block = SimpleNamespace(
            type="tool_use",
            name=vision.TOOL_NAME,
            input={"foods": [{"name": "ovo frito", "quantity_g": 50, "kcal": 107, "protein_g": 7, "carb_g": 0.6, "fat_g": 8.4, "confidence": 0.8}]},
        )
        return SimpleNamespace(content=[block], stop_reason="tool_use")

    fake_client = SimpleNamespace(messages=SimpleNamespace(create=create))
    result = vision.recognize_food(fake_client, bytes([0xFF, 0xD8, 0xFF]), "image/jpeg")

    assert result.foods[0].name == "ovo frito"
    assert calls["model"] == "claude-opus-4-5"
    assert calls["tool_choice"] == {"type": "tool", "name": vision.TOOL_NAME}
    source = calls["messages"][0]["content"][0]["source"]
    assert source["type"] == "base64" and source["media_type"] == "image/jpeg" and source["data"] == "/9j/"


def _call_with_hints(hints):
    from types import SimpleNamespace

    from app import vision

    calls = {}

    def create(**kwargs):
        calls.update(kwargs)
        block = SimpleNamespace(type="tool_use", name=vision.TOOL_NAME, input={"foods": []})
        return SimpleNamespace(content=[block], stop_reason="tool_use")

    client = SimpleNamespace(messages=SimpleNamespace(create=create))
    vision.recognize_food(client, b"x", "image/jpeg", hints)
    return calls["messages"][0]["content"][1]["text"], vision


def test_hints_are_added_to_the_prompt():
    text, vision = _call_with_hints("frango,\n arroz")
    assert "O usuário informou que o prato contém: frango, arroz." in text
    assert "também identifique outros alimentos visíveis" in text


def test_empty_hints_keep_the_original_prompt():
    for hints in ("", "   \n "):
        text, vision = _call_with_hints(hints)
        assert text == vision.PROMPT


def test_hints_endpoint_forwards_form_field(monkeypatch):
    from app import main
    from app.vision import Recognition

    seen = {}
    monkeypatch.setattr(main, "recognize_food", lambda c, d, m, h="": seen.update(h=h) or Recognition(foods=[]))
    r = client.post("/vision/food-recognition", headers=H, data={"hints": "ovo"}, files={"image": JPEG})
    assert r.status_code == 200 and seen["h"] == "ovo"
