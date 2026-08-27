FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Vite bakes VITE_* variables into the static build at build time (not
# read at runtime) — declaring it as a build ARG lets Railway's service
# Variables reach `npm run build` here.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build
RUN npm install -g serve

EXPOSE 3000
# Railway assigns its own port via $PORT and routes external traffic to
# whatever the container actually listens on — hardcoding 3000 caused a
# 502 (nothing was listening on the port Railway expected). Falls back to
# 3000 for local `docker run` testing where $PORT isn't set.
CMD sh -c "serve -s dist -l ${PORT:-3000}"
