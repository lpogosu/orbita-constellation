# Контекст сборки — корень репозитория: образу нужны web/, deploy/nginx.conf и каталог
# сценариев, который nginx отдаёт как статику.

FROM node:22-alpine AS build
WORKDIR /app

# Зависимости ставятся до копирования исходников: правка компонента не пересобирает
# node_modules.
COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
# Сборка включает `tsc --noEmit`: образ не соберётся с ошибкой типов.
RUN npm run build

FROM nginx:1.31.5-alpine AS runtime

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# Примеры сценариев отдаются из репозитория: список приходит из каталога, а не из кода.
COPY scenarios /usr/share/nginx/html/scenarios

EXPOSE 80
