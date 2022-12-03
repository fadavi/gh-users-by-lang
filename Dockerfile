ARG NODE_VERSION=18

FROM node:$NODE_VERSION AS builder
WORKDIR /usr/src
COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src
RUN npm ci
RUN npm run build

FROM node:$NODE_VERSION

ARG PORT=3000
ARG HOST=0.0.0.0
ARG GITHUB_TOKEN

WORKDIR /usr/app
COPY --from=builder /usr/src/package*.json ./
COPY --from=builder /usr/src/dist ./dist
RUN npm ci --omit=dev

ENV PORT=$PORT
ENV HOST=$HOST
ENV GITHUB_TOKEN=$GITHUB_TOKEN
ENV NODE_ENV=production

EXPOSE $PORT
CMD ["node", "./dist/server"]
