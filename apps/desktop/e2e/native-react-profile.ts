import type { ProfilerOnRenderCallback } from "react";

interface RenderSample {
	actualDuration: number;
	baseDuration: number;
	commitTime: number;
	id: string;
	phase: string;
	startTime: number;
}
const samples: RenderSample[] = [];
const limit = 2000;
export const recordNativeRender: ProfilerOnRenderCallback = (
	id,
	phase,
	actualDuration,
	baseDuration,
	startTime,
	commitTime
) => {
	if (samples.length === limit) {
		samples.shift();
	}
	samples.push({
		id,
		phase,
		actualDuration,
		baseDuration,
		startTime,
		commitTime,
	});
};
Object.assign(window, {
	__ryuNativeReactProfile: {
		samples,
		reset: () => {
			samples.length = 0;
		},
		snapshot: () => samples.slice(),
	},
});
