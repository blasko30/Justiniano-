"""§6 — Registro, verificación de correo, login y rotación de refresh tokens."""

SIGNUP = {
    "name": "Ana Torres",
    "email": "ana.torres@empresa-test.cl",
    "phone": "+56912345678",
    "company": "Empresa Test SpA",
    "country": "CL",
    "password": "S3gura!2026",
    "accepts_terms": True,
}


async def test_signup_verify_login_and_refresh_rotation(client, sent_otp):
    # 1. Signup → 201 y OTP enviado por el notifier fake
    r = await client.post("/api/v1/auth/signup", json=SIGNUP)
    assert r.status_code == 201, r.text
    assert r.json()["email_verification"] == "pending"

    # 2. Verificar correo con el OTP capturado de _FakeNotify.sent
    code = sent_otp(SIGNUP["email"])
    r = await client.post("/api/v1/auth/verify-email",
                          json={"email": SIGNUP["email"], "code": code})
    assert r.status_code == 200, r.text
    assert r.json()["email_verified"] is True

    # 3. Login → par de tokens
    r = await client.post("/api/v1/auth/login",
                          json={"email": SIGNUP["email"], "password": SIGNUP["password"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token_type"] == "bearer"
    refresh_1 = body["refresh_token"]

    # 4. Refresh con rotación: entrega un par nuevo y revoca el usado
    r = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_1})
    assert r.status_code == 200, r.text
    refresh_2 = r.json()["refresh_token"]
    assert refresh_2 != refresh_1

    # 5. Reusar el refresh viejo (rotado) → 401 y revocación de la familia
    r = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_1})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_refresh_token"

    # 6. La familia completa quedó revocada: el token nuevo tampoco sirve
    r = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_2})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_refresh_token"


async def test_login_invalid_credentials(client, seed):
    r = await client.post("/api/v1/auth/login",
                          json={"email": seed["client_email"], "password": "Incorrecta1"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_credentials"
