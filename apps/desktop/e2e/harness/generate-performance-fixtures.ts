import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	addTitleSlide,
	createPresentation,
	savePresentation,
} from "@office-kit/pptx";
import { workbookToBytes } from "@office-kit/xlsx/io";
import { addWorksheet, createWorkbook } from "@office-kit/xlsx/workbook";
import { setCell } from "@office-kit/xlsx/worksheet";

const directory = path.join(import.meta.dirname, "performance-fixtures");
await mkdir(directory, { recursive: true });
const presentation = createPresentation();
addTitleSlide(presentation, "Quarterly product review");
await writeFile(
	path.join(directory, "review.pptx"),
	await savePresentation(presentation)
);
const workbook = createWorkbook();
const sheet = addWorksheet(workbook, "Budget");
setCell(sheet, 1, 1, "Category");
setCell(sheet, 1, 2, "Q1");
setCell(sheet, 2, 1, "Revenue");
setCell(sheet, 2, 2, 420_000);
await writeFile(
	path.join(directory, "budget.xlsx"),
	await workbookToBytes(workbook)
);
