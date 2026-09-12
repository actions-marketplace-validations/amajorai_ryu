import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ColorPicker,
	ColorPickerContent,
	ColorPickerPanel,
	ColorPickerPopover,
} from "./color-picker.tsx";

test("renders the complete reference panel without a native color input", () => {
	const html = renderToStaticMarkup(
		<ColorPicker
			defaultValue="#6b97ff"
			inline
			swatches={["#000000", "#ffffff", "#ff3b30"]}
		>
			<ColorPickerContent>
				<ColorPickerPanel />
			</ColorPickerContent>
		</ColorPicker>
	);

	expect(html).toContain('data-slot="color-picker-area"');
	expect(html).toContain('data-slot="color-picker-hue-slider"');
	expect(html).toContain('data-slot="color-picker-alpha-slider"');
	expect(html).toContain('data-slot="color-picker-panel"');
	expect(html).toContain('data-slot="color-picker-swatches"');
	expect(html).toContain('data-color-value="#FF3B30"');
	expect(html).not.toContain('type="color"');
});

test("keeps a compact swatch trigger while using the shared panel", () => {
	const html = renderToStaticMarkup(
		<ColorPickerPopover
			defaultValue="#6b97ff"
			triggerAriaLabel="Text color"
			triggerShowValue={false}
		/>
	);

	expect(html).toContain('aria-label="Text color"');
	expect(html).toContain('data-slot="color-picker-trigger"');
	expect(html).not.toContain('type="color"');
});

test("accepts OKLCH values and exposes its format-aware fields", () => {
	const html = renderToStaticMarkup(
		<ColorPicker
			defaultFormat="oklch"
			defaultValue="oklch(69% 0.16 265)"
			inline
		>
			<ColorPickerContent>
				<ColorPickerPanel />
			</ColorPickerContent>
		</ColorPicker>
	);

	expect(html).toContain('aria-label="OKLCH lightness percentage (0-100)"');
	expect(html).toContain('aria-label="OKLCH chroma (0-0.4)"');
	expect(html).toContain('aria-label="OKLCH hue degree (0-360)"');
	expect(html).toContain('value="69"');
});
