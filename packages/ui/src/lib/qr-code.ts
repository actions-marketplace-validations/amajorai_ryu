import QRCodeLib from "qrcode";

const FINDER_MODULES = 7;
const DOT_RADIUS_RATIO = 1 / 3;

type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

interface QRCodeGeometry {
	circleRadius: number;
	circles: { cx: number; cy: number }[];
	finderPositions: [number, number][];
	finderSize: number;
	innerBlackSize: number;
	innerPadding: number;
	innerWhiteSize: number;
	moduleSize: number;
}

function isInFinderPattern(row: number, column: number, size: number): boolean {
	return (
		(row < FINDER_MODULES && column < FINDER_MODULES) ||
		(row < FINDER_MODULES && column >= size - FINDER_MODULES) ||
		(row >= size - FINDER_MODULES && column < FINDER_MODULES)
	);
}

function createQRCodeGeometry(
	value: string,
	size: number,
	errorCorrectionLevel: ErrorCorrectionLevel = "M"
): QRCodeGeometry | null {
	let qrData: ReturnType<typeof QRCodeLib.create>;
	try {
		qrData = QRCodeLib.create(value, { errorCorrectionLevel });
	} catch {
		return null;
	}

	const moduleCount = qrData.modules.size;
	const moduleSize = size / moduleCount;
	const circles: { cx: number; cy: number }[] = [];

	for (let row = 0; row < moduleCount; row += 1) {
		for (let column = 0; column < moduleCount; column += 1) {
			if (
				qrData.modules.get(row, column) &&
				!isInFinderPattern(row, column, moduleCount)
			) {
				circles.push({
					cx: (column + 0.5) * moduleSize,
					cy: (row + 0.5) * moduleSize,
				});
			}
		}
	}

	return {
		circleRadius: moduleSize * DOT_RADIUS_RATIO,
		circles,
		finderPositions: [
			[0, 0],
			[0, moduleCount - FINDER_MODULES],
			[moduleCount - FINDER_MODULES, 0],
		],
		finderSize: FINDER_MODULES * moduleSize,
		innerBlackSize: 3 * moduleSize,
		innerPadding: moduleSize,
		innerWhiteSize: 5 * moduleSize,
		moduleSize,
	};
}

export type { ErrorCorrectionLevel, QRCodeGeometry };
export { createQRCodeGeometry };
