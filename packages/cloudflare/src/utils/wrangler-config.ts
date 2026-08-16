import fs from "node:fs";
import path from "node:path";

type ServiceBinding = {
	binding: string;
	service: string;
	entrypoint?: string;
};

/** The subset of the resolved wrangler configuration used here. */
type ResolvedConfig = {
	configPath?: string;
	name?: string;
	services?: ServiceBinding[];
};

/**
 * `getPlatformProxy` starts the worker without its script, so it is not able to resolve a service
 * binding referencing a named entrypoint of the worker itself - which is how the OpenNext cache is
 * wired - and fails to start.
 *
 * Those bindings are only used at runtime by the generated worker, dropping them has no effect on
 * what `getPlatformProxy` is used for, so the configuration is rewritten without them.
 *
 * @returns the configuration path to pass to `getPlatformProxy` and a cleanup function to call
 * once the proxy has been disposed of.
 */
export function withoutSelfEntrypointServices(config: ResolvedConfig): {
	configPath: string | undefined;
	cleanup: () => void;
} {
	const services = config.services ?? [];
	const keptServices = services.filter((service) => !(service.entrypoint && service.service === config.name));

	if (!config.configPath || keptServices.length === services.length) {
		return { configPath: config.configPath, cleanup: () => {} };
	}

	// `unsafe` is dropped as wrangler warns about it being experimental, even when it is empty.
	const { unsafe: _unsafe, ...rest } = config as ResolvedConfig & { unsafe?: unknown };

	// The file has to sit next to the original one: relative paths are resolved from its directory.
	const configPath = path.join(path.dirname(config.configPath), `.wrangler.opennext.${process.pid}.json`);

	fs.writeFileSync(configPath, JSON.stringify({ ...rest, services: keptServices }));

	return { configPath, cleanup: () => fs.rmSync(configPath, { force: true }) };
}
