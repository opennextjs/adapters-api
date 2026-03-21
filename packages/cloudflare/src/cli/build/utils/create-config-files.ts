import type { ProjectOptions } from "../../project-options.js";
import { askConfirmation } from "../../utils/ask-confirmation.js";
import { createOpenNextConfigFile, findOpenNextConfig } from "../../utils/create-open-next-config.js";
import { createWranglerConfigFile, findWranglerConfig } from "../../utils/create-wrangler-config.js";

export async function createWranglerConfigIfNonExistent(projectOpts: ProjectOptions): Promise<void> {
	const wranglerConfigFileExists = Boolean(findWranglerConfig(projectOpts.sourceDir));
	if (wranglerConfigFileExists) {
		return;
	}

	const answer = await askConfirmation(
		"No `wrangler.(toml|json|jsonc)` config file found, do you want to create one?"
	);

	if (!answer) {
		console.warn(
			"No Wrangler config file created" +
				"\n" +
				"(to avoid this check use the `--skipWranglerConfigCheck` flag or set a `SKIP_WRANGLER_CONFIG_CHECK` environment variable to `yes`)"
		);
		return;
	}

	await createWranglerConfigFile(projectOpts.sourceDir);
}

export async function createOpenNextConfigIfNotExistent(sourceDir: string): Promise<string> {
	const openNextConfigPath = findOpenNextConfig(sourceDir);
	if (!openNextConfigPath) {
		const answer = await askConfirmation(
			"Missing required `open-next.config.ts` file, do you want to create one?"
		);

		if (!answer) {
			throw new Error("The `open-next.config.ts` file is required, aborting!");
		}

		return createOpenNextConfigFile(sourceDir, { cache: false });
	}

	return openNextConfigPath;
}
