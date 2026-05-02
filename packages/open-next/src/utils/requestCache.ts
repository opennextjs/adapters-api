export class RequestCache {
	private _caches = new Map<string, Map<unknown, unknown>>();

	getOrCreate<K = unknown, V = unknown>(key: string): Map<K, V> {
		let cache = this._caches.get(key) as Map<K, V> | undefined;
		if (!cache) {
			cache = new Map<K, V>();
			this._caches.set(key, cache);
		}
		return cache;
	}
}
