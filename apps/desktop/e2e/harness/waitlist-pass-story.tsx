// Standalone browser story for the REAL WaitlistPass + WaitlistUsernameField
// (packages/ui), the two pieces the web and desktop waitlist screens share.
// Mounts them with fixed props so the 3D tilt, the idle sway, the foil sheen and
// the reserve field can be judged in a real browser without Core, Tauri, or a
// signed-in account. Both themes are rendered side by side because the pass
// leans on color-mix over `--primary`, which is exactly the kind of thing that
// looks right in one scheme and muddy in the other.
//
// Not part of the plugin-runtime cert; served by the same harness Vite config
// via its own html entry.

import { WaitlistPass } from "@ryu/ui/components/waitlist-pass.tsx";
import { WaitlistUsernameField } from "@ryu/ui/components/waitlist-username-field.tsx";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";

function Column({ dark, label }: { dark: boolean; label: string }) {
	const [handle, setHandle] = useState("");
	const [reserved, setReserved] = useState<string | null>(null);

	return (
		<div
			className={`${dark ? "dark" : ""} flex-1 bg-background p-8 text-foreground`}
		>
			<p className="mb-6 font-medium text-muted-foreground text-xs uppercase tracking-widest">
				{label}
			</p>
			<div className="flex flex-col gap-8">
				<div className="w-[20rem]">
					<WaitlistPass
						joinedAt="2026-03-14T10:00:00.000Z"
						metalTheme={dark ? "dark" : "light"}
						name="Ada Lovelace"
						position={42}
						referralCount={7}
						serialSeed="k3x9q2"
						totalWaiting={18_402}
						username={reserved}
					/>
				</div>
				<div className="w-[20rem]">
					<WaitlistUsernameField
						onChange={setHandle}
						onSubmit={() => setReserved(handle.toLowerCase())}
						reserved={reserved}
						value={handle}
					/>
				</div>
				<div className="w-[20rem]">
					{/* An unreserved, position-unknown pass: the empty state the screen
					    shows before /me resolves. */}
					<WaitlistPass
						metalTheme={dark ? "dark" : "light"}
						name="Grace Hopper"
						position={null}
						serialSeed="a1b2c3"
						totalWaiting={null}
					/>
				</div>
			</div>
		</div>
	);
}

function Story() {
	return (
		<div className="flex min-h-screen">
			<Column dark={false} label="light" />
			<Column dark={true} label="dark" />
		</div>
	);
}

const container = document.getElementById("root");
if (container) {
	createRoot(container).render(<Story />);
}
