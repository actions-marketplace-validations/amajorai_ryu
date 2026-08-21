import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
	DEFAULT_FILE_OPENER_VALUES,
	type DefaultFileOpener,
	normalizeDefaultFileOpener,
} from "../../src/lib/default-file-opener.ts";

const SHELL_STORAGE_KEY = "ryu_workspace_terminal_shell";
const OPENER_STORAGE_KEY = "ryu_workspace_default_file_opener";
const FILE_MANAGER_NAME = navigator.userAgent.includes("Mac")
	? "Finder"
	: navigator.userAgent.includes("Windows")
		? "Explorer"
		: "Files";

const FILE_OPENER_LABELS: Record<DefaultFileOpener, string> = {
	system: `OS default (${FILE_MANAGER_NAME})`,
	vscode: "VS Code",
	cursor: "Cursor",
	zed: "Zed",
};

function readShell(): string {
	return localStorage.getItem(SHELL_STORAGE_KEY) ?? "auto";
}

function Proof() {
	const [shell, setShell] = useState(readShell);
	const [fileOpener, setFileOpener] = useState<DefaultFileOpener>(() =>
		normalizeDefaultFileOpener(localStorage.getItem(OPENER_STORAGE_KEY))
	);
	const [status, setStatus] = useState(
		"Defaults loaded: OS shell and OS file opener"
	);

	const updateShell = (value: string) => {
		localStorage.setItem(SHELL_STORAGE_KEY, value);
		setShell(value);
		setStatus(`Saved shell: ${value === "auto" ? "OS default" : value}`);
	};

	const updateFileOpener = (value: DefaultFileOpener) => {
		localStorage.setItem(OPENER_STORAGE_KEY, value);
		setFileOpener(value);
		setStatus(`Saved file opener: ${FILE_OPENER_LABELS[value]}`);
	};

	const reset = () => {
		localStorage.removeItem(SHELL_STORAGE_KEY);
		localStorage.removeItem(OPENER_STORAGE_KEY);
		setShell("auto");
		setFileOpener("system");
		setStatus("Defaults restored: OS shell and OS file opener");
	};

	return (
		<main
			style={{
				background: "#171717",
				boxSizing: "border-box",
				color: "#f5f5f5",
				fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
				minHeight: "100vh",
				padding: "48px 24px",
			}}
		>
			<section
				style={{
					background: "#202020",
					border: "1px solid #3b3b3b",
					borderRadius: 18,
					margin: "0 auto",
					maxWidth: 760,
					padding: 28,
				}}
			>
				<p
					style={{
						color: "#a3a3a3",
						fontSize: 12,
						letterSpacing: "0.12em",
						margin: 0,
						textTransform: "uppercase",
					}}
				>
					Desktop settings · React proof
				</p>
				<h1 style={{ fontSize: 28, margin: "10px 0 8px" }}>General settings</h1>
				<p style={{ color: "#bdbdbd", margin: "0 0 28px" }}>
					The defaults used by terminal commands and the workspace file tree.
				</p>

				<div style={{ display: "grid", gap: 12 }}>
					<label
						style={{
							border: "1px solid #3b3b3b",
							borderRadius: 12,
							display: "grid",
							gap: 8,
							padding: 16,
						}}
					>
						<span style={{ fontWeight: 600 }}>Default shell</span>
						<span style={{ color: "#a3a3a3", fontSize: 13 }}>
							OS default follows the platform shell.
						</span>
						<select
							aria-label="Default shell"
							onChange={(event) => updateShell(event.target.value)}
							value={shell}
						>
							<option value="auto">OS default</option>
							<option value="bash">Bash</option>
							<option value="zsh">Zsh</option>
							<option value="fish">Fish</option>
						</select>
					</label>

					<label
						style={{
							border: "1px solid #3b3b3b",
							borderRadius: 12,
							display: "grid",
							gap: 8,
							padding: 16,
						}}
					>
						<span style={{ fontWeight: 600 }}>Default file opener</span>
						<span style={{ color: "#a3a3a3", fontSize: 13 }}>
							The file tree Open action uses the OS default or an installed
							editor.
						</span>
						<select
							aria-label="Default file opener"
							onChange={(event) =>
								updateFileOpener(event.target.value as DefaultFileOpener)
							}
							value={fileOpener}
						>
							{DEFAULT_FILE_OPENER_VALUES.map((value) => (
								<option key={value} value={value}>
									{FILE_OPENER_LABELS[value]}
								</option>
							))}
						</select>
					</label>
				</div>

				<div
					style={{
						alignItems: "center",
						display: "flex",
						gap: 12,
						marginTop: 20,
					}}
				>
					<button onClick={reset} type="button">
						Reset to OS defaults
					</button>
					<output aria-live="polite" data-testid="proof-status">
						{status}
					</output>
				</div>
			</section>
		</main>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Proof />);
}
