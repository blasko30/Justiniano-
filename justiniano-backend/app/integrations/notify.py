"""Email y SMS — Azure Communication Services o Resend (§1.1).
Simulador registra en log cuando no hay credenciales reales.
"""
import logging

import httpx

from app.core.config import get_settings

log = logging.getLogger("justiniano.notify")


class _ResendEmail:  # pragma: no cover - requiere credenciales
    def __init__(self):
        s = get_settings()
        self._api_key = s.resend_api_key
        self._from = s.resend_from_email or s.email_sender

    def send_email(self, to: str, subject: str, body: str) -> None:
        if not self._api_key:
            raise RuntimeError("RESEND_API_KEY no configurado.")
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {self._api_key}",
                     "Content-Type": "application/json"},
            json={"from": self._from,
                  "to": [to],
                  "subject": subject,
                  "text": body},
            timeout=15,
        )
        response.raise_for_status()

    def send_sms(self, to: str, body: str) -> None:
        raise NotImplementedError("SMS no se entrega por Resend; usar ACS o simulador.")


class _ACS:  # pragma: no cover - requiere credenciales
    def __init__(self):
        from azure.communication.email import EmailClient
        s = get_settings()
        self._email = EmailClient.from_connection_string(s.acs_connection_string)
        self._sender = s.email_sender

    def send_email(self, to: str, subject: str, body: str) -> None:
        self._email.begin_send({"senderAddress": self._sender,
                                "recipients": {"to": [{"address": to}]},
                                "content": {"subject": subject, "plainText": body}})

    def send_sms(self, to: str, body: str) -> None:
        from azure.communication.sms import SmsClient
        SmsClient.from_connection_string(get_settings().acs_connection_string) \
            .send(from_="+56000000000", to=[to], message=body)


class _FakeNotify:
    sent: list[dict] = []  # inspeccionable en tests

    def send_email(self, to: str, subject: str, body: str) -> None:
        self.sent.append({"channel": "email", "to": to, "subject": subject, "body": body})
        log.info("EMAIL → %s · %s", to, subject)

    def send_sms(self, to: str, body: str) -> None:
        self.sent.append({"channel": "sms", "to": to, "body": body})
        log.info("SMS → %s · %s", to, body[:60])


_client = None


def notifier():
    global _client
    if _client is None:
        s = get_settings()
        if s.fake_integrations:
            _client = _FakeNotify()
        elif s.acs_connection_string:
            _client = _ACS()
        elif s.resend_api_key:
            _client = _ResendEmail()
        else:
            _client = _FakeNotify()
    return _client
