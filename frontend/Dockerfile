FROM node:20-alpine

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund

# Copy environment file for Docker
COPY .env.docker ./.env

# Copy source files individually (avoids BuildKit Windows bug)
COPY src/ ./src/
COPY public/ ./public/
COPY index.html .
COPY vite.config.ts .
COPY tsconfig.json .
COPY tsconfig.node.json .
COPY postcss.config.js .
COPY tailwind.config.js .

# Build the application
RUN npm run build

# Serve the built app
RUN npm install -g serve

EXPOSE 5174

CMD ["serve", "-s", "dist", "-l", "5174"]