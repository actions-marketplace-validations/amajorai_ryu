import * as core from "@actions/core";

export interface ActionRuntime {
	exportVariable: (name: string, value: string) => void;
	getInput: (name: string) => string;
	info: (message: string) => void;
	setOutput: (name: string, value: unknown) => void;
	setSecret: (value: string) => void;
	warning: (message: string) => void;
}

export const githubRuntime: ActionRuntime = {
	exportVariable: (name, value) => core.exportVariable(name, value),
	getInput: (name) => core.getInput(name),
	info: (message) => core.info(message),
	setOutput: (name, value) => core.setOutput(name, value),
	setSecret: (value) => core.setSecret(value),
	warning: (message) => core.warning(message),
};
