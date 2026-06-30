FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Copy environment file for Docker
COPY .env.docker ./.env

# Copy only necessary files to avoid BuildKit Windows bug
COPY src/ ./src/
COPY public/ ./public/
COPY index.html .
COPY tsconfig*.json .
COPY vite.config.ts .
COPY postcss.config.js .
COPY tailwind.config.js .
COPY eslint.config.js .

# Build the application
RUN npm run build

# Use a lightweight server for production
RUN npm install -g serve

EXPOSE 5174

CMD ["serve", "-s", "dist", "-l", "5174"]
