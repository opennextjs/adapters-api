import { Writable } from "node:stream";

import type { StreamCreator } from "@opennextjs/core/types/open-next.js";
import { isBinaryContentType } from "@opennextjs/core/utils/binary.js";

type Prelude = Parameters<StreamCreator["writeHeaders"]>[0];

export function createBufferedStreamCreator<T>(
	createOutput: (prelude: Prelude, body: Buffer, isBase64Encoded: boolean) => T
): { streamCreator: StreamCreator; output: Promise<T> } {
	const { promise: output, resolve, reject } = Promise.withResolvers<T>();
	let prelude: Prelude | undefined;
	const chunks: Buffer[] = [];

	const streamCreator: StreamCreator = {
		writeHeaders(value) {
			prelude = value;
			return new Writable({
				write(chunk, _encoding, callback) {
					chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
					callback();
				},
				final(callback) {
					if (!prelude) {
						const error = new Error("Response stream finished before headers were written");
						reject(error);
						callback(error);
						return;
					}
					try {
						const isBase64Encoded =
							isBinaryContentType(prelude.headers["content-type"]) || !!prelude.headers["content-encoding"];
						resolve(createOutput(prelude, Buffer.concat(chunks), isBase64Encoded));
						callback();
					} catch (error: unknown) {
						reject(error);
						callback(error instanceof Error ? error : new Error(String(error)));
					}
				},
			});
		},
	};

	return { streamCreator, output };
}
