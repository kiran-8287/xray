FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
# Delete Windows lock file so npm resolves correct optional deps for Alpine Linux
RUN rm -f package-lock.json && npm install

COPY . .

EXPOSE 5174

CMD ["npm", "run", "dev", "--", "--host"]