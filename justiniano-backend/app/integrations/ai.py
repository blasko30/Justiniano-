"""Azure OpenAI (§1.1): agentes conversacionales y generación de documentos."""
from app.core.config import get_settings

_SYSTEM = ("Eres {agent}, agente legal de Justiniano para empresas en Chile. Responde en español, "
           "fundado en la legislación chilena vigente ({basis}). Contexto de la empresa: {company}. "
           "Cierra con la base legal citada. No des asesoría definitiva: orientación general.")


class _AzureAI:  # pragma: no cover - requiere credenciales
    def __init__(self):
        from openai import AzureOpenAI
        s = get_settings()
        self._client = AzureOpenAI(azure_endpoint=s.azure_openai_endpoint,
                                   api_key=s.azure_openai_api_key, api_version="2024-06-01")

    def chat(self, agent_name: str, legal_basis: str, company_ctx: str, history: list[dict]) -> dict:
        s = get_settings()
        messages = [{"role": "system", "content": _SYSTEM.format(agent=agent_name, basis=legal_basis or "—",
                                                                 company=company_ctx or "—")}] + history
        resp = self._client.chat.completions.create(model=s.azure_openai_deployment,
                                                    messages=messages, temperature=0.2)
        return {"content": resp.choices[0].message.content, "legal_basis": [], "suggestions": []}

    def generate_document(self, template_body: str, fields: dict) -> str:
        s = get_settings()
        prompt = (f"Completa este documento legal chileno con los datos entregados. Mantén la estructura HTML. "
                  f"Plantilla:\n{template_body}\n\nDatos: {fields}")
        resp = self._client.chat.completions.create(model=s.azure_openai_deployment,
                                                    messages=[{"role": "user", "content": prompt}], temperature=0)
        return resp.choices[0].message.content


class _FakeAI:
    def chat(self, agent_name: str, legal_basis: str, company_ctx: str, history: list[dict]) -> dict:
        question = history[-1]["content"] if history else ""
        return {"content": (f"[{agent_name}] Sobre su consulta: «{question[:120]}». Orientación general según la "
                            "legislación chilena vigente: (1) revise el contrato aplicable; (2) documente los "
                            "hechos; (3) los plazos legales corren desde la notificación. Base legal: "
                            f"{legal_basis or 'Código Civil; Código del Trabajo'}."),
                "legal_basis": [{"norm": legal_basis or "Código del Trabajo", "article": "art. 161"}],
                "suggestions": ["¿Qué plazos aplican?", "¿Qué documento debo generar?"]}

    def generate_document(self, template_body: str, fields: dict) -> str:
        filled = template_body or "<h1>DOCUMENTO</h1><p>{cuerpo}</p>"
        for k, v in (fields or {}).items():
            filled = filled.replace("{" + k + "}", str(v))
        return filled


_client = None


def ai_client():
    global _client
    if _client is None:
        s = get_settings()
        _client = _FakeAI() if (s.fake_integrations or not s.azure_openai_api_key) else _AzureAI()
    return _client
