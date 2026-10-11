FROM python:3.12-slim
WORKDIR /srv
COPY justiniano-backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY justiniano-backend/app ./app
COPY documentos ./documentos
ENV LEGAL_DOCUMENTS_DIR=/srv/documentos
ENV LEGAL_INDEX_CACHE_DIR=/srv/legal-index
RUN python -c "from app.integrations.legal_knowledge import build_all_indexes; build_all_indexes()"
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
