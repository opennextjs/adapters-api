export type CompressionEncoding = "br" | "gzip" | "deflate";

/**
 * Selects the best supported content encoding accepted by a client.
 *
 * @param acceptEncoding - The request's Accept-Encoding header value.
 * @returns The selected encoding, or null when compression is not acceptable.
 */
export function selectCompressionEncoding(acceptEncoding: string): CompressionEncoding | null {
	const qualities = new Map<string, number>();
	for (const value of acceptEncoding.split(",")) {
		const [name, ...parameters] = value.trim().toLowerCase().split(";");
		if (!name) continue;
		const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith("q="));
		const quality = qualityParameter ? Number(qualityParameter.trim().slice(2)) : 1;
		qualities.set(name, Number.isFinite(quality) ? Math.min(Math.max(quality, 0), 1) : 0);
	}

	let selected: CompressionEncoding | null = null;
	let selectedQuality = 0;
	for (const encoding of ["br", "gzip", "deflate"] as const) {
		const quality = qualities.get(encoding) ?? qualities.get("*") ?? 0;
		if (quality > selectedQuality) {
			selected = encoding;
			selectedQuality = quality;
		}
	}
	return selected;
}

/**
 * Adds Accept-Encoding to a response's Vary header.
 *
 * @param headers - Response headers to update.
 * @returns A copy of the headers with the required Vary value.
 */
export function withCompressionVary(headers: Record<string, string>): Record<string, string> {
	const vary = headers.vary;
	if (vary?.split(",").some((value) => value.trim().toLowerCase() === "accept-encoding")) {
		return headers;
	}
	return { ...headers, vary: vary ? `${vary}, Accept-Encoding` : "Accept-Encoding" };
}
