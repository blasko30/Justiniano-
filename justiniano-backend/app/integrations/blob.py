"""Azure Blob Storage con SAS de 15 min (§1.1). Simulador local intercambiable."""
import base64
import hashlib
import hmac
import time
import uuid
from pathlib import Path

from app.core.config import get_settings

ALLOWED = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png",
           "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
           "application/vnd.oasis.opendocument.text": ".odt"}
MAGIC = {b"%PDF": "application/pdf", b"\xff\xd8\xff": "image/jpeg", b"\x89PNG": "image/png",
         b"PK\x03\x04": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
MAX_BYTES = 10 * 1024 * 1024


class FileRejected(Exception):
    def __init__(self, code: str, message: str):
        self.code, self.message = code, message


def validate_upload(data: bytes, content_type: str, filename: str) -> str:
    """Whitelist de extensión + MIME real por magic bytes, coincidentes (§2.8 archivo)."""
    if len(data) > MAX_BYTES:
        raise FileRejected("file_too_large", "El archivo supera 10 MB.")
    if content_type not in ALLOWED:
        raise FileRejected("file_invalid", "Tipo de archivo no permitido.")
    sniffed = next((mime for magic, mime in MAGIC.items() if data.startswith(magic)), None)
    if sniffed is None or (sniffed != content_type and not
                           (sniffed == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                            and content_type.endswith("opendocument.text"))):
        raise FileRejected("file_invalid", "El contenido no coincide con el tipo declarado.")
    return f"{uuid.uuid4().hex}{ALLOWED[content_type]}"  # renombrado a UUID


class _AzureBlob:  # pragma: no cover - requiere credenciales
    def __init__(self):
        from azure.storage.blob import BlobServiceClient
        self._svc = BlobServiceClient.from_connection_string(get_settings().azure_blob_connection_string)

    def put(self, container: str, name: str, data: bytes) -> str:
        self._svc.get_blob_client(container, name).upload_blob(data, overwrite=True)
        return f"{container}/{name}"

    def get(self, blob_path: str) -> bytes:
        container, name = blob_path.split("/", 1)
        return self._svc.get_blob_client(container, name).download_blob().readall()

    def delete(self, blob_path: str) -> None:
        container, name = blob_path.split("/", 1)
        self._svc.get_blob_client(container, name).delete_blob()

    def sas_url(self, blob_path: str) -> str:
        from datetime import datetime, timedelta, timezone
        from azure.storage.blob import BlobSasPermissions, generate_blob_sas
        container, name = blob_path.split("/", 1)
        sas = generate_blob_sas(
            account_name=self._svc.account_name, container_name=container, blob_name=name,
            account_key=self._svc.credential.account_key, permission=BlobSasPermissions(read=True),
            expiry=datetime.now(timezone.utc) + timedelta(seconds=get_settings().sas_ttl_seconds))
        return f"{self._svc.url}{container}/{name}?{sas}"


class _LocalBlob:
    """Simulador de desarrollo: disco local + URL firmada HMAC con expiración."""
    def __init__(self):
        self._root = Path(get_settings().blob_local_dir)
        self._root.mkdir(parents=True, exist_ok=True)
        self._secret = b"dev-sas-secret"

    def put(self, container: str, name: str, data: bytes) -> str:
        p = self._root / container / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return f"{container}/{name}"

    def get(self, blob_path: str) -> bytes:
        return (self._root / blob_path).read_bytes()

    def delete(self, blob_path: str) -> None:
        (self._root / blob_path).unlink(missing_ok=True)

    def sas_url(self, blob_path: str) -> str:
        exp = int(time.time()) + get_settings().sas_ttl_seconds
        sig = base64.urlsafe_b64encode(
            hmac.new(self._secret, f"{blob_path}:{exp}".encode(), hashlib.sha256).digest()).decode()
        return f"https://blob.local.justiniano.dev/{blob_path}?se={exp}&sig={sig}"


_client = None


def blob_client():
    global _client
    if _client is None:
        s = get_settings()
        _client = _LocalBlob() if (s.fake_integrations or not s.azure_blob_connection_string) else _AzureBlob()
    return _client
