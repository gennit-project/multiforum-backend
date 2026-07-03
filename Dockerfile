# Use a lightweight Node.js image (22.x, matching package.json "engines")
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Enable pnpm via corepack (version pinned by package.json "packageManager")
RUN corepack enable

# Copy manifest and pnpm lockfile
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy the entire project
COPY . .

# Set environment variables via Docker secrets (fallback to defaults)
ENV ENVIRONMENT development
ENV NEO4J_URI bolt://localhost:7687
ENV NEO4J_USERNAME neo4j
ENV NEO4J_PASSWORD myfearsthey
ENV SERVER_CONFIG_NAME "Listical"
ENV GCS_BUCKET_NAME listical-dev
ENV GOOGLE_APPLICATION_CREDENTIALS /app/config/listical-dev-gcp.json
ENV GOOGLE_CREDENTIALS_BASE64 ""
ENV AUTH0_DOMAIN ""
ENV AUTH0_CLIENT_ID ""
ENV CYPRESS_ADMIN_TEST_EMAIL ""
ENV CYPRESS_ADMIN_TEST_USERNAME ""

# Build the application
RUN pnpm run build

# Expose the backend port
EXPOSE 4000

# Start the application
CMD ["pnpm", "run", "start"]
