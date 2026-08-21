import * as core from "@actions/core";
import { executeAction } from "./runner.ts";

void executeAction().catch((error: unknown) => {
	core.setFailed(error instanceof Error ? error.message : String(error));
});
