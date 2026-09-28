"""Límites de tasa (§2.7) — ventana deslizante en memoria.

En producción con más de una réplica debe respaldarse en Redis; la interfaz
(dependencia `limit`) no cambia.
"""
import time
from collections import defaultdict, deque

from fastapi import Request

from app.core.errors import ApiError

_buckets: dict[str, deque] = defaultdict(deque)


def _hit(key: str, limit: int, window_s: int) -> None:
    now = time.monotonic()
    q = _buckets[key]
    while q and q[0] < now - window_s:
        q.popleft()
    if len(q) >= limit:
        raise ApiError(429, "rate_limited", "Demasiadas solicitudes.", {"retry_after_s": window_s})
    q.append(now)


def limit(name: str, per: int, window_s: int, by: str = "ip"):
    async def dep(request: Request):
        ident = request.client.host if by == "ip" else \
            getattr(getattr(request.state, "user", None), "id", request.client.host)
        _hit(f"{name}:{ident}", per, window_s)
    return dep
