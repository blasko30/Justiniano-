"""Esquemas de la §8 — Catálogos: países, agentes y formatos de documento.

Los cinco endpoints de esta sección son de solo lectura (GET sin cuerpo),
por lo que no requieren modelos Pydantic de entrada; los parámetros de
consulta se validan en el router (área contra el catálogo en BD, §8.4).
Las respuestas son dicts que calzan con los ejemplos de la especificación.
"""
