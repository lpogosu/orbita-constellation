# Контекст сборки — корень репозитория: образу нужны и web/public, и deploy/nginx.conf.
# Сборки фронтенда пока нет: nginx отдаёт статику и проксирует /api на api.
FROM nginx:1.31.5-alpine AS runtime

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY web/public /usr/share/nginx/html

EXPOSE 80
