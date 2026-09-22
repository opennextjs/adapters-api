/**
 * Generates the default Dockerfile for Node.js server bundles.
 *
 * Native dependencies are rebuilt inside the target Linux image so copied
 * artifacts from the build host are not used unchanged.
 *
 * @returns The default Dockerfile contents.
 */
export function getDefaultDockerfile(): string {
	return `
FROM node:24-bookworm-slim
WORKDIR /app
COPY . /app
RUN cp package.json /tmp/package.json \
    && npm pkg delete scripts.preinstall scripts.install scripts.postinstall scripts.prepare \
    && npm rebuild --foreground-scripts \
    && mv /tmp/package.json package.json
EXPOSE 3000
CMD ["node", "index.mjs"]
    `;
}
