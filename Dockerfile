# Multi-stage production container for VOXEL3D CAD (Node.js + Python + WebAssembly)
FROM node:20-bookworm-slim

# Install Python 3 for native STEP assembly splitting engine
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    libgl1 \
    libglu1-mesa \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The STEP exporter needs the native CAD kernel in production as well as locally.
RUN python3 -m venv /opt/cad-python
ENV PATH="/opt/cad-python/bin:$PATH"
COPY server/requirements.txt ./server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt

# Install Node dependencies first for efficient layer caching
COPY package.json ./
RUN npm install --include=dev --legacy-peer-deps

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
