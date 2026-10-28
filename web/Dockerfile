# Portal web (React + Vite): build estático servido pelo nginx. Sem porta publicada no host: o Traefik chega
# ao container pela rede Docker (porta interna 80).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html/admin
EXPOSE 80
