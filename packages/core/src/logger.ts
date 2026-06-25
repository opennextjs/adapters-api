import chalk from "chalk";

type LEVEL = "info" | "debug";

let logLevel: LEVEL = "info";

export default {
	setLevel: (level: LEVEL) => (logLevel = level),
	debug: (...args: unknown[]) => {
		if (logLevel !== "debug") return;
		console.log(chalk.magenta("DEBUG"), ...args);
	},
	info: console.log,
	warn: (...args: unknown[]) => console.warn(chalk.yellow("WARN"), ...args),
	error: (...args: unknown[]) => console.error(chalk.red("ERROR"), ...args),
	time: console.time,
	timeEnd: console.timeEnd,
};
