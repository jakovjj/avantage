# syntax=docker/dockerfile:1

# ---- 1. faza: build statične stranice ----
FROM node:22-alpine AS build
WORKDIR /app

# Najprije ovisnosti (iskorištava Docker keš slojeva)
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- 2. faza: posluživanje preko nginx-a ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
	CMD wget -qO- http://localhost/ > /dev/null || exit 1
