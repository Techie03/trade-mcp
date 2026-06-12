# Build stage
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src
RUN npm run build

# Production stage
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

# Expose port for HTTP/SSE transport (Hugging Face Spaces expects 7860)
EXPOSE 7860

# Set default env to HTTP transport on port 7860
ENV MCP_TRANSPORT=http
ENV PORT=7860

CMD ["node", "dist/index.js"]
