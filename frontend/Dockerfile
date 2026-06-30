FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Copy only necessary files to avoid BuildKit Windows bug
COPY src/ ./src/
COPY public/ ./public/
COPY index.html .
COPY tsconfig*.json .
COPY vite.config.ts .
COPY postcss.config.js .
COPY tailwind.config.js .
COPY eslint.config.js .

EXPOSE 5174

CMD ["npm", "run", "dev", "--", "--host"]
