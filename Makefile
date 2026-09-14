# Команды стека описаны в deploy/Makefile; здесь только делегирование, чтобы
# `make up` работал из корня репозитория.

.DEFAULT_GOAL := help
.PHONY: help up down test demo degraded logs ps

help up down test demo degraded logs ps:
	$(MAKE) -C deploy $@
