/**
 * A simple utility to cache values scoped to a request.
 * It uses our internal AsyncLocalStorage (globalThis.__openNextAls) to store the cache.
 *
 * This is useful for deduplicating operations within the same request,
 * such as DynamoDB queries for tag cache lookups.
 */
export class RequestCache<K, V> {
	getOrSet(key: K, factory: () => Promise<V>): Promise<V> {
		const store = globalThis.__openNextAls.getStore();
		if (!store) {
			return factory();
		}
		// We use "requestCache" as a property on the store
		// and lazily initialize a Map for each cache instance
		// oxlint-disable-next-line @typescript-eslint/no-explicit-any
		const reqCache = (store as any).requestCache as Map<RequestCache<K, V>, Map<K, Promise<V>>> | undefined;
		if (!reqCache) {
			// oxlint-disable-next-line @typescript-eslint/no-explicit-any
			(store as any).requestCache = new Map();
		}
		// oxlint-disable-next-line @typescript-eslint/no-explicit-any
		const cache = (store as any).requestCache as Map<RequestCache<K, V>, Map<K, Promise<V>>>;
		if (!cache.has(this)) {
			cache.set(this, new Map());
		}
		const innerCache = cache.get(this)!;
		if (innerCache.has(key)) {
			return innerCache.get(key)!;
		}
		const promise = factory();
		innerCache.set(key, promise);
		return promise;
	}
}
