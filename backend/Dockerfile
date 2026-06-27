FROM node:20-alpine

# Install curl for Docker healthcheck
RUN apk add --no-cache curl

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 8080

CMD ["npm", "run", "dev"]
