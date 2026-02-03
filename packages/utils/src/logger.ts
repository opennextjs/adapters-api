export function debug(...args: unknown[]) {
	if (process.env.OPEN_NEXT_DEBUG) {
		console.log(...args);
	}
}

export function warn(...args: unknown[]) {
	console.warn(...args);
}

export function error(...args: unknown[]) {
	console.error(...args);
}

export const awsLogger = {
	trace: () => {},
	debug: () => {},
	info: debug,
	warn,
	error,
};
