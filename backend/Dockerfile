FROM node:20-alpine

# Install curl for Docker healthcheck, and Python3 + pip + Pillow for raw file processing
RUN apk add --no-cache curl python3 py3-pip py3-numpy py3-pillow && ln -sf /usr/bin/python3 /usr/bin/python

WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .

EXPOSE 8080

CMD ["npm", "run", "start"]
