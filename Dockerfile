# Multi-stage build for Dogecoin Node with Web Monitor

# Stage 1: Download Dogecoin binaries
FROM alpine:latest AS dogecoin-downloader

# Install minimal tools for fetching latest release and downloading binaries
RUN apk add --no-cache \
    wget \
    tar \
    ca-certificates \
    curl \
    jq

# Fetch latest Dogecoin release and download binaries
WORKDIR /tmp
RUN LATEST_RELEASE=$(curl -s https://api.github.com/repos/dogecoin/dogecoin/releases/latest | jq -r '.tag_name') \
    && echo "Latest Dogecoin release: $LATEST_RELEASE" \
    && RELEASE_VERSION=${LATEST_RELEASE#v} \
    && DOWNLOAD_URL="https://github.com/dogecoin/dogecoin/releases/download/${LATEST_RELEASE}/dogecoin-${RELEASE_VERSION}-x86_64-linux-gnu.tar.gz" \
    && echo "Downloading from: $DOWNLOAD_URL" \
    && wget "$DOWNLOAD_URL" \
    && tar -xzf "dogecoin-${RELEASE_VERSION}-x86_64-linux-gnu.tar.gz" \
    && cp "dogecoin-${RELEASE_VERSION}/bin/dogecoind" /usr/local/bin/ \
    && cp "dogecoin-${RELEASE_VERSION}/bin/dogecoin-cli" /usr/local/bin/ \
    && chmod +x /usr/local/bin/dogecoind /usr/local/bin/dogecoin-cli \
    && echo "Downloaded binaries for version $LATEST_RELEASE:" \
    && ls -la /usr/local/bin/dogecoin*

# Stage 2: Build frontend
FROM node:18-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --only=production && npm cache clean --force
COPY frontend/ .

# Stage 3: Runtime image
FROM ubuntu:22.04

# Install only essential runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    nodejs \
    npm \
    libssl3 \
    libevent-2.1-7 \
    libboost-system1.74.0 \
    libboost-filesystem1.74.0 \
    libboost-chrono1.74.0 \
    libboost-program-options1.74.0 \
    libboost-thread1.74.0 \
    libdb5.3++ \
    libc6 \
    libgcc-s1 \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean \
    && rm -rf /tmp/* /var/tmp/*

# Copy Dogecoin binaries from downloader stage
COPY --from=dogecoin-downloader /usr/local/bin/dogecoind /usr/local/bin/
COPY --from=dogecoin-downloader /usr/local/bin/dogecoin-cli /usr/local/bin/
RUN chmod +x /usr/local/bin/dogecoind /usr/local/bin/dogecoin-cli

# Verify binaries work
RUN echo "Verifying Dogecoin binaries:" \
    && ls -la /usr/local/bin/dogecoin* \
    && dogecoind --version \
    && dogecoin-cli --version

# Copy frontend application with dependencies
COPY --from=frontend-builder /app/frontend /app/frontend
WORKDIR /app/frontend

# Create dogecoin data directories, logs directory, and generate comprehensive configuration
RUN mkdir -p /data /app/logs 

# Copy startup script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose ports
EXPOSE 22556 3000

# Set default environment variables
ENV NODE_ENV=production

LABEL name="dogecoin-node-monitor" 
LABEL description="Dogecoin fullnode container with web monitoring interface (latest release, optimized)"
LABEL maintainer="Dogecoin Monitor <monitor@dogecoin.local>"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
