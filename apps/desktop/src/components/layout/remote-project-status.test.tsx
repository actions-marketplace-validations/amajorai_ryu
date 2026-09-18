import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
	RemoteProjectStatus,
	remoteProjectStatusState,
} from "./remote-project-status.tsx";

describe("remote project status", () => {
	test("maps the shared active-node probe to a compact state", () => {
		expect(remoteProjectStatusState(null)).toBe("checking");
		expect(remoteProjectStatusState(true)).toBe("online");
		expect(remoteProjectStatusState(false)).toBe("offline");
	});

	test("renders the remote node label and accessible status", () => {
		const html = renderToStaticMarkup(
			<RemoteProjectStatus nodeName="cloud-vm" online={false} />
		);
		expect(html).toContain('data-project-connection-status="offline"');
		expect(html).toContain('data-project-node-name="vm"');
		expect(html).toContain('aria-label="vm: offline"');
	});
});
