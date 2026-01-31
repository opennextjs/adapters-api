import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";

export async function GET() {
	const headersList = await headers();

	const fromCloudflareContext = headersList.has("from-cloudflare-context");

	if (!fromCloudflareContext) {
		return new Response("Hello World!");
	}

	// Retrieve the bindings defined in wrangler.json
	return new Response(getCloudflareContext().env.hello);
}

export async function POST(request: Request) {
	const text = await request.text();
	return new Response(`Hello post-World! body=${text}`);
}
