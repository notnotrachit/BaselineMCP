### Multi-stage Dockerfile
## Builder: installs dependencies and builds TypeScript
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build


## Runtime image: only production dependencies and built output
FROM node:20-alpine AS runner
WORKDIR /app

# Use non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy package manifests and install production deps
COPY package.json package-lock.json* ./
ENV NODE_ENV=production
RUN npm ci --production

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Expose default port
ARG PORT=3001
ENV PORT=${PORT}
EXPOSE ${PORT}

# Run in SSE mode by default; override with args or CMD
USER appuser
CMD ["node", "dist/index.js", "sse"]
