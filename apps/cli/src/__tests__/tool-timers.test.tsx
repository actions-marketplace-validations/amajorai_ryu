/* @jsxImportSource @opentui/react */
import { expect, spyOn, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { act, useState } from "react";
import { ThemeProvider } from "../../components/ui/theme-provider.tsx";
import { ToolCall } from "../../components/ui/tool-call.tsx";
import {
	InputFocusProvider,
	useSetInputFocused,
} from "../core/InputFocusContext.tsx";

test("completed tool rows have no timers and running rows share animation", async () => {
	const originalSet = globalThis.setInterval;
	const originalClear = globalThis.clearInterval;
	const timers = new Map<unknown, unknown>();
	const wrapped = ((...args: unknown[]) => {
		const id: unknown = Reflect.apply(originalSet, globalThis, args);
		if (args[1] === 83 || args[1] === 100) {
			timers.set(id, args[1]);
		}
		return id;
	}) as typeof setInterval;
	const set = spyOn(globalThis, "setInterval").mockImplementation(wrapped);
	const clear = spyOn(globalThis, "clearInterval").mockImplementation((id) => {
		timers.delete(id);
		Reflect.apply(originalClear, globalThis, [id]);
	});
	let update!: (running: boolean) => void;
	let setFixed!: (fixed: boolean) => void;
	function View() {
		const [running, setRunning] = useState(false);
		const [fixed, updateFixed] = useState(true);
		setFixed = updateFixed;
		update = setRunning;
		return (
			<ThemeProvider reducedMotion={false}>
				{Array.from({ length: 20 }, (_, i) => (
					<ToolCall
						collapsible={false}
						duration={fixed ? 42 : undefined}
						key={i}
						name={`tool-${i}`}
						status={running && i < 2 ? "running" : "success"}
					/>
				))}
			</ThemeProvider>
		);
	}
	const setup = await testRender(<View />, { width: 80, height: 30 });
	try {
		await setup.renderOnce();
		expect(timers.size).toBe(0);
		await act(async () => {
			update(true);
		});
		expect([...timers.values()]).toEqual([83]);
		await act(async () => {
			await Bun.sleep(120);
			setFixed(false);
		});
		expect(timers.size).toBe(3);
		await setup.renderOnce();
		const elapsed = setup.captureCharFrame().match(/tool-0\s+\((\d+)ms\)/);
		expect(Number(elapsed?.[1])).toBeGreaterThanOrEqual(100);
		await act(async () => {
			await Bun.sleep(100);
			update(false);
		});
		expect(timers.size).toBe(0);
		await setup.renderOnce();
		const frame = setup.captureCharFrame();
		expect(frame).toContain("tool-19");
		await writeFile(
			resolve(
				import.meta.dirname,
				"../../../../docs/proof/performance-sweep/cli-tool-rows.txt"
			),
			`${frame
				.split("\n")
				.map((line) => line.trimEnd())
				.join("\n")
				.trimEnd()}\n`
		);
	} finally {
		await act(async () => {
			setup.renderer.destroy();
		});
		set.mockRestore();
		clear.mockRestore();
	}
});

test("tool disclosure keys do not consume text-input Enter", async () => {
	let focus!: (value: boolean) => void;
	function View() {
		focus = useSetInputFocused();
		return <ToolCall name="inspect" result="visible-result" status="success" />;
	}
	const setup = await testRender(
		<ThemeProvider>
			<InputFocusProvider>
				<View />
			</InputFocusProvider>
		</ThemeProvider>,
		{ width: 80, height: 15 }
	);
	const enter = async () => {
		await act(async () => {
			(
				setup.renderer as unknown as {
					keyInput: { emit: (event: string, data: unknown) => void };
				}
			).keyInput.emit("keypress", {
				name: "return",
				sequence: "",
				shift: false,
				ctrl: false,
				meta: false,
				option: false,
				eventType: "press",
				repeated: false,
			});
		});
		await setup.renderOnce();
	};
	try {
		await enter();
		expect(setup.captureCharFrame()).toContain("visible-result");
		await act(async () => {
			focus(true);
		});
		await enter();
		expect(setup.captureCharFrame()).toContain("visible-result");
		await act(async () => {
			focus(false);
		});
		await enter();
		expect(setup.captureCharFrame()).not.toContain("visible-result");
	} finally {
		await act(async () => {
			setup.renderer.destroy();
		});
	}
});
