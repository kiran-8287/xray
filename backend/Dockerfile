FROM node:20-alpine

# Install curl for Docker healthcheck, and Python3 + pip + Pillow for raw file processing
RUN apk add --no-cache curl python3 py3-pip py3-numpy py3-pillow

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 8080

CMD ["npm", "run", "dev"]