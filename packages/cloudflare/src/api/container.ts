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
}

export function getOpenNextContainer(containerNamespace: DurableObjectNamespace<OpenNextContainer>) {
	return getContainer(containerNamespace, OPEN_NEXT_CONTAINER_NAME);
}
