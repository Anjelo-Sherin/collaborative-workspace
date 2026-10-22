FROM node:22-slim

# Install Python 3 for polyglot sandbox execution
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests
COPY package.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application code
COPY . .

# Compile client bundle
RUN npx esbuild client/app.js --bundle --minify --sourcemap --outfile=public/bundle.js --format=esm

# Create persistent storage directory
RUN mkdir -p /app/data/rooms

ENV NODE_ENV=production
ENV PORT=8012

EXPOSE 8012

CMD ["node", "server/index.js"]
