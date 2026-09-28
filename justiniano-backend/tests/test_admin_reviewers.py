"""§21 — Consola de revisores: overview, asignación manual, reasignación y
suspensión (los casos vuelven a la bolsa)."""


async def test_reviewers_overview(client, admin_headers):
    r = await client.get("/api/v1/admin/reviewers/overview", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("reviewers", "workload", "pending_assignment",
                "applications_pending", "sla_global_90d_pct"):
        assert key in body
    assert body["pending_assignment"]["total"] >= 1  # el caso sembrado en la bolsa


async def test_manual_assign_reassign_and_suspend_returns_to_pool(
        client, seed, admin_headers):
    rid = seed["pool_review_id"]
    law1, law2 = seed["lawyer_id"], seed["lawyer2_id"]

    # 1. Asignación manual del pendiente → estado 2, source=admin
    r = await client.post(f"/api/v1/admin/reviews/{rid}/assign",
                          json={"lawyer_id": law1}, headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["state"] == 2
    assert body["source"] == "admin"
    assert body["lawyer_id"] == law1

    # 2. Volver a asignar el mismo caso → 409 (ya no está en la bolsa)
    r = await client.post(f"/api/v1/admin/reviews/{rid}/assign",
                          json={"lawyer_id": law2}, headers=admin_headers)
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "already_assigned"

    # 3. Reasignación a otro revisor → estado 2 con el nuevo abogado
    r = await client.patch(f"/api/v1/admin/reviews/{rid}/assignment",
                           json={"lawyer_id": law2, "reason": "overload",
                                 "detail": "Revisor al límite de capacidad."},
                           headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["state"] == 2
    assert body["lawyer_id"] == law2
    assert body["previous_lawyer_id"] == law1

    # 4. Suspender al revisor entrante devuelve sus casos a la bolsa
    r = await client.post(f"/api/v1/admin/lawyers/{law2}/suspend",
                          json={"reason": "Incumplimiento reiterado de los plazos comprometidos."},
                          headers=admin_headers)
    assert r.status_code == 200, r.text
    assert rid in r.json()["returned_to_pool"]

    # 5. El caso reaparece como pendiente de asignar (estado 1, sin abogado)
    r = await client.get("/api/v1/admin/reviews",
                         params={"status": "pending_assignment"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    match = [i for i in items if i["id"] == rid]
    assert match and match[0]["state"] == 1
