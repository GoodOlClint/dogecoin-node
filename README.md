# Dogecoin Node Monitor

[![Docker Pulls](https://img.shields.io/docker/pulls/goodolclint/dogecoin-node)](https://hub.docker.com/r/goodolclint/dogecoin-node)
[![GitHub Actions](https://github.com/GoodOlClint/dogecoin-node/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/GoodOlClint/dogecoin-node/actions)
[![Security Scan](https://github.com/GoodOlClint/dogecoin-node/actions/workflows/security-scan.yml/badge.svg)](https://github.com/GoodOlClint/dogecoin-node/actions)


A monitoring and security dashboard for Dogecoin Core nodes, with a modern Express.js backend and Docker support.

## Dogecoin Core Version
- **Recommended:** v1.14.x or later
- The monitor is compatible with any recent Dogecoin Core node (tested with v1.14.7+)

## Docker Usage
You can run the monitor using Docker in several ways:

### Build locally
```sh
docker build -t goodolclint/dogecoin-node .
docker run -d -p 3000:3000 --name dogecoin-node goodolclint/dogecoin-node
```

### Pull from Docker Hub
```sh
docker pull goodolclint/dogecoin-node:latest
docker run -d -p 3000:3000 --name dogecoin-node goodolclint/dogecoin-node:latest
```

### Pull from GitHub Container Registry (GHCR)
```sh
docker pull ghcr.io/goodolclint/dogecoin-node:latest
docker run -d -p 3000:3000 --name dogecoin-node ghcr.io/goodolclint/dogecoin-node:latest
```

## NPM Package Information
- **Node.js version:** 18.x or later recommended
- **Key dependencies:**
  - express (5.x)
  - express-rate-limit (8.x)
  - geoip-lite
  - winston
  - ws
  - axios
  - eslint (dev)
  - nodemon (dev)
- To install dependencies:

```sh
cd frontend
npm install
```

## Features
- Real-time Dogecoin node health and metrics
- Security monitoring and alerting
- REST API and WebSocket support
- Rate limiting and security middleware
- Docker and CI/CD ready

## Contributing
Pull requests and issues are welcome!

## License
MIT
