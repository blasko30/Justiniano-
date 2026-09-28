"""Paginación estándar (§2.5)."""
from fastapi import Query

from app.core.errors import ApiError


class PageParams:
    def __init__(self, page: int = Query(1), page_size: int = Query(20)):
        if page < 1 or not (1 <= page_size <= 100):  # fuera de rango → 422, sin truncar (§2.8)
            raise ApiError(422, "validation_error", "Paginación fuera de rango.",
                           {"fields": [{"field": "page/page_size", "issue": "page ≥ 1; page_size 1–100"}]})
        self.page, self.page_size = page, page_size
        self.offset = (page - 1) * page_size


def page_response(items: list, total: int, p: PageParams) -> dict:
    return {"items": items, "total": total, "page": p.page, "page_size": p.page_size}
