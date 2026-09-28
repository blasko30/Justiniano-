"""Email y SMS — Azure Communication Services (§1.1). Simulador registra en log."""
import logging

from app.core.config import get_settings

log = logging.getLogger("justiniano.notify")


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
        _client = _FakeNotify() if (s.fake_integrations or not s.acs_connection_string) else _ACS()
    return _client
