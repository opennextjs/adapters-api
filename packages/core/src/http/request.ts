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
			let started = false;
			const reader = body.getReader();
			const pump = () => {
				reader.read().then(({ done, value }) => {
					if (done) {
						this.push(null);
					} else {
						this.push(value);
						pump();
					}
				});
			};
			return () => {
				if (!started) {
					started = true;
					pump();
				}
			};
		})();
	}
}
