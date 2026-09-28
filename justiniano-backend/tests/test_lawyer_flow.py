"""§20 — Flujo del abogado: signup → verificación admin → bolsa → claim →
anotaciones → entrega con declaración (devenga honorario)."""

import pytest
from sqlalchemy import select

import app.models as m

LAWYER_SIGNUP = {
    "name": "Nueva Abogada Pérez",
    "rut": "18.765.432-7",
    "email": "n.perez@correo-test.cl",
    "phone": "+56911112222",
    "birth_date": "1991-03-20",
    "city": "Santiago",
    "password": "S3gura#2026",
    "accepts_urgent": True,
    "promoter": False,
    "availability": "5_15h",
    "terms_accepted": True,
    "terms_version": "2026-06",
    "sworn_declaration": True,
}


async def _signup_lawyer(client, auth_headers, session_factory):
    r = await client.post("/api/v1/auth/lawyer-signup", json=LAWYER_SIGNUP)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["verification_status"] == "pending"
    headers = auth_headers(body["user_id"], LAWYER_SIGNUP["email"], "lawyer")
    # Especialidades declaradas (§20.2 las envía con la acreditación multipart;
    # aquí se siembran directo para no depender de ese contrato de archivos).
    async with session_factory() as db:
        lawyer = await db.get(m.Lawyer, body["id"])
        lawyer.specialties_pending = ["lab", "con"]
        await db.commit()
    return body["id"], headers


async def _approve(client, admin_headers, lawyer_id):
    r = await client.patch(f"/api/v1/admin/lawyers/{lawyer_id}/verification",
                           json={"status": "verified", "approved_specialties": ["lab", "con"]},
                           headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["verification_status"] == "verified"


async def test_pool_gated_until_verified_then_visible(client, seed, auth_headers,
                                                       admin_headers, session_factory):
    """GET /reviews/pool: 403 lawyer_not_verified antes de aprobar; luego lista la bolsa."""
    lawyer_id, headers = await _signup_lawyer(client, auth_headers, session_factory)

    r = await client.get("/api/v1/reviews/pool", headers=headers)
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "lawyer_not_verified"

    await _approve(client, admin_headers, lawyer_id)

    r = await client.get("/api/v1/reviews/pool", headers=headers)
    assert r.status_code == 200, r.text
    assert seed["pool_review_id"] in [i["id"] for i in r.json()["items"]]


async def test_lawyer_claim_annotate_and_deliver(client, seed, auth_headers,
                                                 admin_headers, session_factory):
    lawyer_id, headers = await _signup_lawyer(client, auth_headers, session_factory)
    await _approve(client, admin_headers, lawyer_id)

    # Claim: pasos 2 y 3 atómicos → estado 3
    rid = seed["pool_review_id"]
    r = await client.post(f"/api/v1/reviews/pool/{rid}/claim", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["state"] == 3

    # Crear una anotación sobre el documento en revisión
    r = await client.post(f"/api/v1/lawyers/me/reviews/{rid}/annotations",
                          json={"kind": "comment", "paragraph_index": 0,
                                "comment_text": "Precisar la fecha de término del contrato."},
                          headers=headers)
    assert r.status_code == 201, r.text
    assert r.json()["kind"] == "comment"

    # La entrega exige la declaración de revisión íntegra
    r = await client.post(f"/api/v1/lawyers/me/reviews/{rid}/deliver",
                          json={"final_observations":
                                "La causal está bien invocada; sugiero precisar el aviso previo "
                                "y la fecha de término.",
                                "declaration": True},
                          headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["state"] == 4
    assert body["fee_entry"]["amount_clp"] == 28000  # review urgente, tarifario v1

    # El fee entry quedó persistido y apunta a la revisión entregada
    async with session_factory() as db:
        fee = (await db.execute(
            select(m.LawyerFeeEntry).where(m.LawyerFeeEntry.review_id == rid)
        )).scalar_one()
        assert fee.kind == "review"
        assert fee.urgency == "fast"
        assert fee.amount_clp == 28000
        assert fee.settlement_id is None
