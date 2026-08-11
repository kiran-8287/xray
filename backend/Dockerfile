FROM node:20-alpine

ENV LOG_LEVEL=warn

# Install curl for Docker healthcheck, Python deps for image processing,
# and su-exec so the entrypoint can drop privileges after fixing mount permissions.
RUN apk add --no-cache \
      curl \
      python3 py3-pip py3-numpy py3-pillow py3-scipy py3-opencv \
      su-exec \
  && ln -sf /usr/bin/python3 /usr/bin/python

WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .

# Ensure the entrypoint is executable
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8080

# Start as root so the entrypoint can chown bind-mounted /app/data,
# then drop to the non-root `node` user before exec'ing the app.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["npm", "run", "start"]
