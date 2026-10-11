from types import SimpleNamespace

import pytest
from openai import APITimeoutError

from app.models import Agent


def test_ai_client_does_not_silently_simulate_without_a_provider(monkeypatch):
    import app.integrations.ai as ai

    monkeypatch.setattr(ai, "_client", None)
    monkeypatch.setattr(ai, "get_settings", lambda: SimpleNamespace(
        fake_integrations=False, nvidia_api_key="", azure_openai_api_key=""
    ))

    with pytest.raises(RuntimeError, match="No AI provider configured"):
        ai.ai_client()


@pytest.mark.asyncio
async def test_civil_chat_uses_and_exposes_legal_documents(
    client, seed, auth_headers, session_factory, monkeypatch
):
    import app.integrations.ai as ai

    monkeypatch.setattr(ai, "_client", ai._FakeAI())
    async with session_factory() as db:
        db.add(Agent(
            id="civ", icon="🏛️", color="#8A6D3B",
            name_i18n={"es": "Civil"}, description_i18n={"es": "Derecho civil"},
            legal_basis="Código Civil", premium=False, sort=1,
        ))
        await db.commit()

    headers = auth_headers(seed["client_id"], seed["client_email"], "client", "p_free")
    created = await client.post("/api/v1/consultations", json={"agent_id": "civ"}, headers=headers)
    assert created.status_code == 201, created.text
    consultation_id = created.json()["id"]

    response = await client.post(
        f"/api/v1/consultations/{consultation_id}/messages",
        json={"content": "¿Qué obligaciones regula el Código Civil chileno?"},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    assistant = response.json()["assistant_message"]
    sources = [item for item in assistant["legal_basis"] if isinstance(item, dict) and item.get("source_id")]
    assert sources, "La respuesta debe mostrar documentos legales recuperados."
    assert any("DFL-1_30-MAY-2000.pdf" in source["title"] for source in sources)
    assert sources[0]["excerpt"]
    assert sources[0]["url"] == f"/legal-sources/{sources[0]['source_id']}"

    download = await client.get(f"/api/v1{sources[0]['url']}", headers=headers)
    assert download.status_code == 200
    assert download.headers["content-type"] == "application/pdf"
    assert download.content.startswith(b"%PDF")


@pytest.mark.asyncio
async def test_legal_source_download_requires_authentication(client):
    response = await client.get("/api/v1/legal-sources/civ_000000000000000000000000")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_unknown_legal_source_is_not_found(client, seed, auth_headers):
    headers = auth_headers(seed["client_id"], seed["client_email"], "client", "p_free")
    response = await client.get(
        "/api/v1/legal-sources/civ_000000000000000000000000",
        headers=headers,
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_ai_timeout_returns_a_clear_gateway_timeout(
    client, seed, auth_headers, session_factory, monkeypatch
):
    import httpx
    import app.api.s09_consultations.router as consultations

    async with session_factory() as db:
        db.add(Agent(
            id="civ", icon="🏛️", color="#8A6D3B",
            name_i18n={"es": "Civil"}, description_i18n={"es": "Derecho civil"},
            legal_basis="Código Civil", premium=False, sort=1,
        ))
        await db.commit()

    headers = auth_headers(seed["client_id"], seed["client_email"], "client", "p_free")
    created = await client.post("/api/v1/consultations", json={"agent_id": "civ"}, headers=headers)
    assert created.status_code == 201, created.text

    class _SlowAI:
        async def chat(self, *args, **kwargs):
            raise APITimeoutError(request=httpx.Request("POST", "https://nvidia.example/chat"))

    monkeypatch.setattr(consultations, "ai_client", lambda: _SlowAI())
    response = await client.post(
        f"/api/v1/consultations/{created.json()['id']}/messages",
        json={"content": "Consulta de prueba sobre el Código Civil"},
        headers=headers,
    )
    assert response.status_code == 504
    assert response.json()["error"]["code"] == "ai_timeout"
