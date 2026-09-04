FROM node:20-slim AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist /app/dist
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev && npm cache clean --force
EXPOSE 8000
CMD ["node", "dist/main.js"]
