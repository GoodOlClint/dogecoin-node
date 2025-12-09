# Multi-stage build for Dogecoin Node with Web Monitor

# Stage 1: Download Dogecoin binaries
FROM alpine:3.23 AS dogecoin-downloader

# Set shell options for better error handling
SHELL ["/bin/ash", "-eo", "pipefail", "-c"]

# Install minimal tools for fetching latest release and downloading binaries
# Note: Not pinning versions for build-time tools to avoid breaking when Alpine updates packages
RUN apk add --no-cache \
    ca-certificates \
    curl \
    jq \
    tar

# Fetch latest Dogecoin release and download binaries
WORKDIR /tmp
RUN set -e && \
    echo "Fetching latest Dogecoin release..." && \
    LATEST_RELEASE=$(curl -s --connect-timeout 30 --max-time 60 --retry 3 --retry-delay 5 \
        https://api.github.com/repos/dogecoin/dogecoin/releases/latest | jq -r '.tag_name') && \
    echo "Latest Dogecoin release: $LATEST_RELEASE" && \
    if [ -z "$LATEST_RELEASE" ] || [ "$LATEST_RELEASE" = "null" ]; then \
        echo "Failed to fetch latest release, using fallback version v1.14.7" && \
        LATEST_RELEASE="v1.14.7"; \
    fi && \
    RELEASE_VERSION=${LATEST_RELEASE#v} && \
    DOWNLOAD_URL="https://github.com/dogecoin/dogecoin/releases/download/${LATEST_RELEASE}/dogecoin-${RELEASE_VERSION}-x86_64-linux-gnu.tar.gz" && \
    echo "Downloading from: $DOWNLOAD_URL" && \
    curl -L --progress-bar \
        --connect-timeout 60 \
        --max-time 300 \
        --retry 3 \
        --retry-delay 10 \
        -o "dogecoin-${RELEASE_VERSION}-x86_64-linux-gnu.tar.gz" \
        "$DOWNLOAD_URL" && \
    echo "Download completed, extracting..." && \
    tar -xzf "dogecoin-${RELEASE_VERSION}-x86_64-linux-gnu.tar.gz" && \
    echo "Extraction completed, copying binaries..." && \
    cp "dogecoin-${RELEASE_VERSION}/bin/dogecoind" /usr/local/bin/ && \
    cp "dogecoin-${RELEASE_VERSION}/bin/dogecoin-cli" /usr/local/bin/ && \
    chmod +x /usr/local/bin/dogecoind /usr/local/bin/dogecoin-cli && \
    echo "Downloaded binaries for version $LATEST_RELEASE:" && \
    ls -la /usr/local/bin/dogecoin* && \
    echo "Cleaning up temporary files..." && \
    rm -rf /tmp/*

# Stage 2: Build frontend
FROM node:25-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --only=production && npm cache clean --force
COPY frontend/ .

# Stage 3: Runtime image - Use newer Debian bookworm for security fixes
FROM node:25-bookworm-slim

# Set shell options for better error handling
SHELL ["/bin/bash", "-eo", "pipefail", "-c"]

# Update package lists and upgrade all packages for security patches
# hadolint ignore=DL3008
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libboost-chrono1.74.0 \
    libboost-filesystem1.74.0 \
    libboost-program-options1.74.0 \
    libboost-system1.74.0 \
    libboost-thread1.74.0 \
    libc6 \
    libdb5.3++ \
    libevent-2.1-7 \
    libgcc-s1 \
    libssl3 \
    libstdc++6 \
    libzmq5 \
    zlib1g \
    && echo "Verifying zlib version for CVE-2023-45853 fix:" \
    && dpkg -l | grep zlib \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Copy Dogecoin binaries from downloader stage
COPY --from=dogecoin-downloader /usr/local/bin/dogecoind /usr/local/bin/
COPY --from=dogecoin-downloader /usr/local/bin/dogecoin-cli /usr/local/bin/

# Verify binaries exist and are executable
RUN chmod +x /usr/local/bin/dogecoind /usr/local/bin/dogecoin-cli && \
    echo "Verifying Dogecoin binaries exist:" && \
    ls -la /usr/local/bin/dogecoin* && \
    test -x /usr/local/bin/dogecoind && \
    test -x /usr/local/bin/dogecoin-cli && \
    echo "Dogecoin binaries are present and executable"

# Copy frontend application with dependencies
COPY --from=frontend-builder /app/frontend /app/frontend
WORKDIR /app/frontend

# Create non-root user and directories for security
RUN groupadd -r dogecoin && \
    useradd -r -g dogecoin -d /app -s /bin/bash dogecoin && \
    mkdir -p /data /app/logs && \
    chown -R dogecoin:dogecoin /data /app

# Copy startup script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose ports
EXPOSE 22556 3000

# Set default environment variables
ENV NODE_ENV=production

# Switch to non-root user
USER dogecoin

LABEL name="dogecoin-node" 
LABEL description="Dogecoin fullnode container with web monitoring interface (latest release, optimized)"
LABEL maintainer="GoodOlClint <goodolclint@gmail.com>"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
