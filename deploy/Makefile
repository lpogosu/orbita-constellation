# Команды стека ОРБИТЫ. Работают и отсюда, и из корня репозитория через
# корневой Makefile, который делегирует сюда.

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/..)
COMPOSE := docker compose -f $(ROOT)/deploy/docker-compose.yml
COMPOSE_DEGRADED := $(COMPOSE) -f $(ROOT)/deploy/compose.degraded.yml

# Порт api на хосте; должен совпадать с API_PORT в deploy/.env, если файл создан.
API_PORT ?= 8000

# Сколько ждать готовности сервисов: первая сборка образов дольше, но `up` возвращает
# управление только когда health-проверки прошли, иначе следующая команда бьёт в пустоту.
WAIT_TIMEOUT ?= 300

.DEFAULT_GOAL := help
.PHONY: help up down test demo degraded logs ps

help:
	@echo "make up        - собрать и поднять семь сервисов, дождаться готовности"
	@echo "make down      - остановить стек, тома сохранить"
	@echo "make test      - линтеры, типы и тесты: core, api, worker"
	@echo "make demo      - поднять стек, показать /api/health и проверить очередь"
	@echo "make degraded  - профиль без redis, memgraph и minio (degraded mode);"
	@echo "                 сначала останавливает стек, поднимается тем же make up,"
	@echo "                 останавливается тем же make down"
	@echo "make logs      - логи всех сервисов"
	@echo "make ps        - состояние контейнеров"

up:
	$(COMPOSE) up -d --build --wait --wait-timeout $(WAIT_TIMEOUT)

# Останавливает и обычный стек, и degraded: имя проекта у них одно.
down:
	$(COMPOSE) down --remove-orphans

# Проверки идут в том же образе, что и сервисы: локально установленный Python не нужен
# и «у меня работает» невозможно.
test:
	docker build -f $(ROOT)/api/Dockerfile --target dev -t orbita-backend:checks $(ROOT)
	docker run --rm orbita-backend:checks

demo: up
	@echo "== GET /api/health =="
	curl -s http://localhost:$(API_PORT)/api/health
	@echo ""
	@echo "== GET /api/version =="
	curl -s http://localhost:$(API_PORT)/api/version
	@echo ""
	@echo "== сквозная проверка очереди: api -> redis -> worker =="
	$(COMPOSE) exec -T worker python -m orbita_worker.queue_check
	@echo "Интерфейс: http://localhost:3000"

# Сначала `down`: сервис, попавший в неактивный профиль, compose не останавливает, а
# просто перестаёт замечать. Без остановки redis, memgraph и minio, поднятые прошлым
# `make up`, продолжали бы работать, и degraded оставался бы объявленным, а не настоящим.
degraded: down
	$(COMPOSE_DEGRADED) up -d --build --wait --wait-timeout $(WAIT_TIMEOUT)

logs:
	$(COMPOSE) logs --tail 200

ps:
	$(COMPOSE) ps
