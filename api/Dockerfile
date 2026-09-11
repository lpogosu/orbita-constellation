# Образ общий для api и worker (06_STORAGE.md §1): оба вызывают orbita_core и должны
# считать одной и той же версией ядра, иначе результаты Run перестают совпадать.
# Контекст сборки — корень репозитория.
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Сначала только описания пакетов и исходники без тестов: слой с зависимостями
# перестраивается лишь при изменении pyproject.
COPY core/pyproject.toml core/pyproject.toml
COPY core/orbita_core core/orbita_core
COPY api/pyproject.toml api/pyproject.toml
COPY api/orbita_api api/orbita_api
COPY worker/pyproject.toml worker/pyproject.toml
COPY worker/orbita_worker worker/orbita_worker

RUN pip install ./core ./api ./worker

EXPOSE 8000

CMD ["uvicorn", "orbita_api.main:app", "--host", "0.0.0.0", "--port", "8000"]

# Стадия проверок: линтеры, типы и тесты запускаются в том же окружении, что и сервис,
# поэтому «у меня локально работает» невозможно. Собирается только для `make test`.
FROM runtime AS dev

COPY core/tests core/tests
COPY api/tests api/tests
COPY worker/tests worker/tests

# Editable-установка поверх обычной: иначе mypy видит один и тот же пакет дважды —
# в исходниках и в site-packages.
RUN pip install -e "./core[dev]" -e "./api[dev]" -e "./worker[dev]"

CMD ["sh", "-ec", "\
for package in core api worker; do \
  echo \"== $package ==\"; \
  cd /app/$package; \
  ruff check .; \
  mypy; \
  pytest -q; \
done"]
