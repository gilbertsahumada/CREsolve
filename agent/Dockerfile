FROM node:20-alpine
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/index.ts"]
