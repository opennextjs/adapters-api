import { Container, getContainer } from "@cloudflare/containers";
import { env } from "cloudflare:workers";

export const OPEN_NEXT_CONTAINER_BINDING = "OPEN_NEXT_CONTAINER";
export const OPEN_NEXT_CONTAINER_NAME = "default";

/**
 * Selects Worker variables that can be passed to the container process.
 *
 * Worker vars and secrets are strings, while service bindings are objects and
 * must remain in the Worker runtime.
 *
 * @param bindings Worker environment bindings.
 * @returns String-valued bindings suitable for Container `envVars`.
 */
export function getContainerEnvVars(bindings: Record<string, unknown>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(bindings).filter((entry): entry is [string, string] => typeof entry[1] === "string")
	);
}

/**
 * The Durable Object controller for the Node.js OpenNext server container.
 *
 * The matching Wrangler configuration must declare this class as a container
 * and bind it as `OPEN_NEXT_CONTAINER`.
 */
export class OpenNextContainer extends Container {
	override defaultPort = 3000;
	override envVars = getContainerEnvVars(env as Record<string, unknown>);

	/**
	 * Normalize the Durable Object request before forwarding it to the Container.
	 *
	 * In local workerd, the request received by a Durable Object can originate
	 * from another runtime realm. The Container base class checks it with
	 * `instanceof Request`, which then fails and coerces it to "[object Request]".
	 * The public protocol is also recorded at this trusted boundary because the
	 * container transport itself uses HTTP.
	 *
	 * @param request The request to forward to the container.
	 * @returns The response produced by the container.
	 */
	override fetch(request: Request): Promise<Response> {
		const headers = new Headers(request.headers);
		headers.set("x-forwarded-proto", new URL(request.url).protocol.slice(0, -1));
		return this.containerFetch(
			request.url,
			{
				method: request.method,
				headers,
				body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
			},
			this.defaultPort
		);
	}
}

export function getOpenNextContainer(containerNamespace: DurableObjectNamespace<OpenNextContainer>) {
	return getContainer(containerNamespace, OPEN_NEXT_CONTAINER_NAME);
}
