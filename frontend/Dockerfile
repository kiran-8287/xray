FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Copy environment file for Docker
COPY .env.docker ./.env

# Copy all source files (node_modules excluded by .dockerignore)
COPY . .

# Build the application
RUN npm run build

# Use a lightweight server for production
RUN npm install -g serve

EXPOSE 5174

CMD ["serve", "-s", "dist", "-l", "5174"]
