# Multi-stage production container for VOXEL3D CAD (Node.js + Python + WebAssembly)
FROM node:20-bookworm-slim

# Install Python 3 for native STEP assembly splitting engine
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies first for efficient layer caching
COPY package.json ./
RUN npm install --legacy-peer-deps

# Copy application source code
COPY . .

# Build frontend production bundle (Vite SPA into dist/)
RUN npm run build

# Ensure persistent models directory exists
RUN mkdir -p /app/server/saved_models

# Expose default port
EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

# Start production server directly with bundled Node.js server
CMD ["node", "dist-server/server.js"]
