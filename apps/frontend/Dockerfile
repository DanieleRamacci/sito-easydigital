FROM node:20-alpine AS build
WORKDIR /workspace

ARG APP_SUBPATH=gestionale-2

COPY package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/frontend ./apps/frontend

RUN npm install
RUN npm --workspace @eda/frontend run build -- --base-href "/${APP_SUBPATH}/" --deploy-url "/${APP_SUBPATH}/"

FROM nginx:1.27-alpine AS prod
ARG APP_SUBPATH=gestionale-2
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
RUN mkdir -p /usr/share/nginx/html/${APP_SUBPATH}
COPY --from=build /workspace/apps/frontend/dist/frontend/browser /usr/share/nginx/html/${APP_SUBPATH}
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
