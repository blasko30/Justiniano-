"""Local retrieval over the legal reference files assigned to each IA agent."""
import csv
import gzip
import hashlib
import html
import io
import json
import logging
import math
import re
import unicodedata
import zipfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_AGENT_FOLDERS = {
    "civ": Path("Agente Civil") / "Civil",
    "soc": Path("Agente Societario") / "Sociedades",
    "pi": Path("Agente Propiedad Intelectual") / "PI",
    "pd": Path("Agente Protección de Datos") / "Proteccion Datos",
}
_TEXT_EXTENSIONS = {".csv", ".html", ".htm", ".txt", ".xml"}
_ARCHIVE_EXTENSIONS = {".pdf", *_TEXT_EXTENSIONS}
_TOKEN_RE = re.compile(r"[a-z0-9]{3,}")
_STOPWORDS = {
    "ante", "bajo", "cada", "como", "con", "cual", "cuando", "desde", "donde",
    "entre", "esta", "este", "esto", "fue", "han", "hasta", "hay", "para", "por",
    "que", "quien", "sobre", "son", "sus", "tiene", "una", "uno",
    "chile", "chilena", "chilenas", "chileno", "chilenos",
}
_CHUNK_SIZE = 1600
_CHUNK_OVERLAP = 250
_MAX_ARCHIVE_MEMBERS = 200
_MAX_ARCHIVE_MEMBER_BYTES = 8 * 1024 * 1024
_MAX_SOURCES = 4
_MAX_CONTEXT_CHARS = 5200


@dataclass(frozen=True)
class _Chunk:
    source_id: str
    title: str
    page: int | None
    text: str


_INDEXES: dict[tuple[str, str], tuple[tuple[tuple[str, int, int], ...], list[_Chunk]]] = {}


class LegalKnowledgeUnavailable(Exception):
    """The configured legal reference collection cannot be searched."""


def _root() -> Path:
    configured = Path(get_settings().legal_documents_dir)
    if not configured.is_absolute():
        configured = Path.cwd() / configured
    return configured.resolve()


def _cache_root() -> Path:
    configured = Path(get_settings().legal_index_cache_dir)
    if not configured.is_absolute():
        configured = Path.cwd() / configured
    return configured.resolve()


def _agent_root(agent_id: str, root: Path) -> Path | None:
    folder = _AGENT_FOLDERS.get(agent_id)
    if folder is None:
        return None
    path = (root / folder).resolve()
    return path if path.is_relative_to(root) else None


def _source_id(agent_id: str, path: Path, root: Path) -> str:
    relative = path.resolve().relative_to(root).as_posix()
    digest = hashlib.sha256(relative.encode("utf-8")).hexdigest()[:24]
    return f"{agent_id}_{digest}"


def _tokens(text: str) -> list[str]:
    normalized = unicodedata.normalize("NFKD", text.casefold())
    plain = "".join(char for char in normalized if not unicodedata.combining(char))
    return [word for word in _TOKEN_RE.findall(plain) if word not in _STOPWORDS]


def _chunks(text: str, source_id: str, title: str, page: int | None) -> list[_Chunk]:
    clean = re.sub(r"\s+", " ", text).strip()
    if not clean:
        return []
    result = []
    start = 0
    while start < len(clean):
        end = min(start + _CHUNK_SIZE, len(clean))
        excerpt = clean[start:end].strip()
        if excerpt:
            result.append(_Chunk(source_id, title, page, excerpt))
        if end == len(clean):
            break
        start = end - _CHUNK_OVERLAP
    return result


def _pdf_chunks(data: bytes, source_id: str, title: str) -> list[_Chunk]:
    reader = PdfReader(io.BytesIO(data))
    result = []
    for page_number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        result.extend(_chunks(text, source_id, title, page_number))
    return result


def _text_chunks(data: bytes, source_id: str, title: str, suffix: str) -> list[_Chunk]:
    text = data.decode("utf-8-sig", errors="replace")
    if suffix in {".html", ".htm", ".xml"}:
        text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    elif suffix == ".csv":
        rows = csv.reader(io.StringIO(text))
        text = "\n".join(" | ".join(row) for row in rows)
    return _chunks(text, source_id, title, None)


def _read_file(path: Path, source_id: str, title: str, *, archive: bool = False) -> list[_Chunk]:
    suffix = path.suffix.casefold()
    try:
        if archive:
            with zipfile.ZipFile(path) as zipped:
                result = []
                for member in zipped.infolist()[:_MAX_ARCHIVE_MEMBERS]:
                    member_path = Path(member.filename)
                    if member.is_dir() or member_path.suffix.casefold() not in _ARCHIVE_EXTENSIONS:
                        continue
                    if member.file_size > _MAX_ARCHIVE_MEMBER_BYTES:
                        logger.warning("Skipping oversized legal archive member: %s", member.filename)
                        continue
                    data = zipped.read(member)
                    member_title = f"{title} · {member.filename}"
                    member_suffix = member_path.suffix.casefold()
                    if member_suffix == ".pdf":
                        result.extend(_pdf_chunks(data, source_id, member_title))
                    else:
                        result.extend(_text_chunks(data, source_id, member_title, member_suffix))
                return result
        data = path.read_bytes()
        if suffix == ".pdf":
            return _pdf_chunks(data, source_id, title)
        if suffix in _TEXT_EXTENSIONS:
            return _text_chunks(data, source_id, title, suffix)
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        logger.warning("Could not read legal reference %s: %s", path, exc)
    except Exception:
        logger.exception("Unexpected error reading legal reference %s", path)
    return []


def _file_signature(files: list[Path]) -> tuple[tuple[str, int, int], ...]:
    signature = []
    for path in files:
        try:
            stat = path.stat()
            signature.append((str(path), stat.st_mtime_ns, stat.st_size))
        except OSError:
            logger.warning("Legal reference disappeared while indexing: %s", path)
    return tuple(signature)


def _index(agent_id: str, root: Path) -> list[_Chunk]:
    agent_root = _agent_root(agent_id, root)
    if agent_root is None or not agent_root.is_dir():
        raise LegalKnowledgeUnavailable(f"No legal document folder is configured for agent {agent_id}.")
    files = sorted(
        path for path in agent_root.rglob("*")
        if path.is_file()
        and path.resolve().is_relative_to(root)
        and path.suffix.casefold() in _TEXT_EXTENSIONS | {".pdf", ".zip"}
    )
    if not files:
        raise LegalKnowledgeUnavailable(f"No legal reference files were found for agent {agent_id}.")

    cache_key = (str(root), agent_id)
    signature = _file_signature(files)
    cached = _INDEXES.get(cache_key)
    if cached is not None and cached[0] == signature:
        return cached[1]

    cache_path = _cache_root() / f"{agent_id}.json.gz"
    if cache_path.is_file():
        try:
            payload = json.loads(gzip.decompress(cache_path.read_bytes()))
            cached_signature = tuple(tuple(item) for item in payload["signature"])
            if cached_signature == signature:
                chunks = [_Chunk(**item) for item in payload["chunks"]]
                _INDEXES[cache_key] = (signature, chunks)
                return chunks
        except (OSError, EOFError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            logger.warning("Discarding invalid legal index cache: %s", cache_path)

    chunks = []
    for path in files:
        source_id = _source_id(agent_id, path, root)
        title = path.name
        chunks.extend(_read_file(path, source_id, title, archive=path.suffix.casefold() == ".zip"))
    if not chunks:
        raise LegalKnowledgeUnavailable(f"No readable text was extracted for agent {agent_id}.")
    _INDEXES[cache_key] = (signature, chunks)
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({
            "signature": signature,
            "chunks": [chunk.__dict__ for chunk in chunks],
        }, ensure_ascii=False).encode("utf-8")
        temporary_path = cache_path.with_suffix(".tmp")
        temporary_path.write_bytes(gzip.compress(payload))
        temporary_path.replace(cache_path)
    except OSError:
        logger.exception("Could not persist legal index cache: %s", cache_path)
    logger.info("Indexed %d legal passages for agent %s from %d files", len(chunks), agent_id, len(files))
    return chunks


def build_all_indexes() -> None:
    """Pre-index all four agents when building a deployable backend image."""
    root = _root()
    for agent_id in _AGENT_FOLDERS:
        _index(agent_id, root)


def _rank(chunks: list[_Chunk], query: str) -> list[tuple[float, _Chunk]]:
    query_terms = set(_tokens(query))
    if not query_terms:
        return []
    documents = [_tokens(chunk.text) for chunk in chunks]
    document_frequency = Counter(term for terms in documents for term in set(terms))
    total = len(chunks)
    ranked = []
    for chunk, terms in zip(chunks, documents):
        frequencies = Counter(terms)
        matched = query_terms.intersection(frequencies)
        if len(matched) < min(2, len(query_terms)):
            continue
        score = sum(
            (1 + math.log((total + 1) / (document_frequency[term] + 1)))
            * min(frequencies[term], 3)
            for term in matched
        ) / math.sqrt(max(len(terms), 1))
        score *= 1 + len(matched) / len(query_terms)
        ranked.append((score, chunk))
    return sorted(ranked, key=lambda item: item[0], reverse=True)


def retrieve_sources(agent_id: str, query: str) -> tuple[str, list[dict]]:
    """Return bounded, relevant passages and authenticated links to their original files."""
    if agent_id not in _AGENT_FOLDERS:
        return "", []
    root = _root()
    chunks = _index(agent_id, root)
    ranked = _rank(chunks, query)

    selected: list[_Chunk] = []
    seen: set[tuple[str, int | None]] = set()
    for _, chunk in ranked:
        key = (chunk.source_id, chunk.page)
        if key in seen:
            continue
        seen.add(key)
        selected.append(chunk)
        if len(selected) >= _MAX_SOURCES:
            break

    sources = []
    context_parts = []
    used_chars = 0
    for index, chunk in enumerate(selected, start=1):
        excerpt = chunk.text[:1200]
        source = {
            "title": chunk.title,
            "source_id": chunk.source_id,
            "page": chunk.page,
            "excerpt": excerpt,
            "url": f"/legal-sources/{chunk.source_id}",
        }
        sources.append(source)
        page_label = f", página {chunk.page}" if chunk.page else ""
        part = f"[S{index}] {chunk.title}{page_label}\n{excerpt}"
        if used_chars + len(part) > _MAX_CONTEXT_CHARS:
            break
        context_parts.append(part)
        used_chars += len(part)
    return "\n\n".join(context_parts), sources


def resolve_source(source_id: str) -> Path | None:
    """Resolve an opaque source id only against the four allowlisted document folders."""
    if "_" not in source_id:
        return None
    agent_id, digest = source_id.split("_", 1)
    if agent_id not in _AGENT_FOLDERS or not re.fullmatch(r"[a-f0-9]{24}", digest):
        return None
    root = _root()
    agent_root = _agent_root(agent_id, root)
    if agent_root is None or not agent_root.is_dir():
        return None
    for path in agent_root.rglob("*"):
        if (not path.is_file() or not path.resolve().is_relative_to(root)
                or path.suffix.casefold() not in _TEXT_EXTENSIONS | {".pdf", ".zip"}):
            continue
        if _source_id(agent_id, path, root) == source_id:
            return path
    return None
