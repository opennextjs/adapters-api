import { Container, getContainer } from "@cloudflare/containers";

export const OPEN_NEXT_CONTAINER_BINDING = "OPEN_NEXT_CONTAINER";
export const OPEN_NEXT_CONTAINER_NAME = "default";

/**
 * The Durable Object controller for the Node.js OpenNext server container.
 *
 * The matching Wrangler configuration must declare this class as a container
 * and bind it as `OPEN_NEXT_CONTAINER`.
 */
export class OpenNextContainer extends Container {
	override defaultPort = 3000;

	/**
	 * Normalize the Durable Object request before forwarding it to the Container.
	 *
	 * In local workerd, the request received by a Durable Object can originate
	 * from another runtime realm. The Container base class checks it with
	 * `instanceof Request`, which then fails and coerces it to "[object Request]".
	 */
	override fetch(request: Request): Promise<Response> {
		return this.containerFetch(
			request.url,
			{
				method: request.method,
				headers: request.headers,
				body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
			},
			this.defaultPort
		);
	}
}

export function getOpenNextContainer(containerNamespace: DurableObjectNamespace<OpenNextContainer>) {
	return getContainer(containerNamespace, OPEN_NEXT_CONTAINER_NAME);
}
