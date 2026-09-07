// Copied and modified from serverless-http by Doug Moscrop
// https://github.com/dougmoscrop/serverless-http/blob/master/lib/request.js
// Licensed under the MIT License

// @ts-nocheck
import http from "node:http";
import type { ReadableStream } from "node:stream/web";

export class IncomingMessage extends http.IncomingMessage {
	constructor({
		method,
		url,
		headers,
		body,
		remoteAddress,
	}: {
		method: string;
		url: string;
		headers: Record<string, string | string[]>;
		body?: ReadableStream;
		remoteAddress?: string;
	}) {
		super({
			encrypted: true,
			readable: false,
			remoteAddress,
			address: () => ({ port: 443 }),
			end: Function.prototype,
			destroy: Function.prototype,
		});

		Object.assign(this, {
			ip: remoteAddress,
			complete: true,
			httpVersion: "1.1",
			httpVersionMajor: "1",
			httpVersionMinor: "1",
			method,
			headers,
			body,
			url,
		});

		this._read = (() => {
			if (!body) {
				return () => {
					this.push(null);
				};
			}
			const reader = body.getReader();
			let reading = false;
			let streamDone = false;

			this.once("close", () => {
				if (!streamDone) {
					streamDone = true;
					reader.cancel().catch(() => {});
				}
			});

			const pump = () => {
				reading = true;
				reader
					.read()
					.then(({ done, value }) => {
						if (done) {
							streamDone = true;
							reader.releaseLock();
							this.push(null);
						} else {
							const canContinue = this.push(value);
							if (canContinue) {
								pump();
							} else {
								reading = false;
							}
						}
					})
					.catch((err) => {
						streamDone = true;
						reader.cancel().catch(() => {});
						this.destroy(err);
					});
			};

			return () => {
				if (!reading) {
					pump();
				}
			};
		})();
	}
}
