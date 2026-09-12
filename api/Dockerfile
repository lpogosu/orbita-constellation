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
# Конфигурация Alembic нужна в runtime: контейнер api применяет миграции перед стартом.
COPY api/alembic.ini api/alembic.ini
COPY worker/pyproject.toml worker/pyproject.toml
COPY worker/orbita_worker worker/orbita_worker

RUN pip install ./core ./api ./worker

EXPOSE 8000

CMD ["uvicorn", "orbita_api.main:app", "--host", "0.0.0.0", "--port", "8000"]

# Стадия проверок: линтеры, типы и тесты запускаются в том же окружении, что и сервис,
# поэтому «у меня локально работает» невозможно. Собирается только для `make test`.
FROM runtime AS dev

# Тест OpenAPI сверяет схему с разделом «Endpoint map» документа, а не с копией списка
# в коде, а golden-тесты ядра берут эталонные значения из таблицы фикстур: оба документа
# нужны в образе проверок.
COPY docs/05_API.md docs/05_API.md
COPY docs/10_FIXTURES.md docs/10_FIXTURES.md
# Сверка ядра с эталонным модулем и интеграционные тесты api читают файлы сценариев и
# сам эталон, поэтому обе папки нужны в стадии проверок.
COPY scenarios scenarios
COPY ["Расчетный модуль", "Расчетный модуль"]
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
