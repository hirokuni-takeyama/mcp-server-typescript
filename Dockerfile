# ---------- build stage ----------
FROM node:22-alpine AS build
WORKDIR /app

# 依存解決（devDepsも入れる）
COPY package*.json ./
RUN npm install --ignore-scripts

# ソース投入してビルド
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---------- runtime stage ----------
FROM node:22-alpine
WORKDIR /app

# 本番に必要な依存だけ入れる
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts

# ビルド成果物をコピー
COPY --from=build /app/build ./build

# 環境変数（任意）
ENV NODE_ENV=production

# ポートは Cloud Run の設定で 3000 にしているので EXPOSE は不要だが、書いてもOK
EXPOSE 3000

# エントリポイント（ビルド成果物を直接起動）
CMD ["node", "build/main/main/cli.js", "http"]
