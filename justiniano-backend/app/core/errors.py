"""Formato de error estándar (§2.4)."""
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    """Error de negocio con el formato {"error": {code, message, details}}."""

    def __init__(self, status: int, code: str, message: str, details: dict[str, Any] | None = None):
        self.status, self.code, self.message, self.details = status, code, message, details


def error_body(code: str, message: str, details: dict | None = None) -> dict:
    err: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        err["details"] = details
    return {"error": err}


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return JSONResponse(status_code=exc.status, content=error_body(exc.code, exc.message, exc.details))

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        fields = [{"field": ".".join(str(p) for p in e["loc"][1:]), "issue": e["msg"]} for e in exc.errors()]
        return JSONResponse(status_code=422, content=error_body(
            "validation_error", "Los datos enviados no son válidos.", {"fields": fields}))

    @app.exception_handler(Exception)
    async def _internal(_: Request, exc: Exception):
        return JSONResponse(status_code=500, content=error_body("internal_error", "Error interno."))


# Atajos frecuentes
def not_found(msg: str = "Recurso no encontrado.") -> ApiError:
    return ApiError(404, "not_found", msg)


def forbidden(code: str = "forbidden", msg: str = "No autorizado para este recurso.") -> ApiError:
    return ApiError(403, code, msg)
