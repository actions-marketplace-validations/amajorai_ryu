"use strict";
const {
	app,
	BrowserWindow,
} = require("/Users/jiawei/Documents/Code/ryu-closed/node_modules/.bun/electron@33.4.11/node_modules/electron");
const fs = require("node:fs");

const proofPath =
	"file:///Users/jiawei/Documents/Code/ryu-closed/apps/desktop/e2e/harness/dist-git-actions-proof/git-actions-proof.html";
const outputPath =
	"/Users/jiawei/Documents/Code/ryu-closed/apps/desktop/test-results/git-pr-ci-proof.png";

app.whenReady().then(async () => {
	const window = new BrowserWindow({
		width: 1440,
		height: 1000,
		show: false,
		webPreferences: { sandbox: false },
	});
	await window.loadURL(proofPath);
	await new Promise((resolve) => setTimeout(resolve, 750));
	const image = await window.webContents.capturePage();
	fs.writeFileSync(outputPath, image.toPNG());
	await app.quit();
});
