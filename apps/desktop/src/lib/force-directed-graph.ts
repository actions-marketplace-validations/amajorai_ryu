export interface ForceGraphNode {
	id: string;
}

export interface ForceGraphEdge {
	source: string;
	target: string;
}

export interface ForceGraphPoint {
	x: number;
	y: number;
}

const IDEAL_DISTANCE = 130;
const SEED_RADIUS = 320;

/**
 * Deterministic Fruchterman–Reingold layout for the modest graphs shown in the
 * desktop shell. Keeping this pure and shared makes GraphRAG and Library
 * relations use the same node-graph language without adding a physics runtime.
 */
export function layoutForceGraph(
	nodes: readonly ForceGraphNode[],
	edges: readonly ForceGraphEdge[]
): Map<string, ForceGraphPoint> {
	const count = nodes.length;
	const positions: ForceGraphPoint[] = nodes.map((_, index) => {
		const angle = (2 * Math.PI * index) / Math.max(1, count);
		return {
			x: Math.cos(angle) * SEED_RADIUS,
			y: Math.sin(angle) * SEED_RADIUS,
		};
	});
	const indexOf = new Map(nodes.map((node, index) => [node.id, index]));
	const links = edges
		.map(
			(edge) => [indexOf.get(edge.source), indexOf.get(edge.target)] as const
		)
		.filter((pair): pair is [number, number] =>
			pair.every((value) => value !== undefined)
		);

	// Cap total work so a large installed catalog never blocks the UI thread.
	const iterations = Math.max(
		60,
		Math.min(300, Math.round(20_000 / (count + 1)))
	);
	const k = IDEAL_DISTANCE;

	for (let iteration = 0; iteration < iterations; iteration += 1) {
		const displacement: ForceGraphPoint[] = positions.map(() => ({
			x: 0,
			y: 0,
		}));
		for (let first = 0; first < count; first += 1) {
			for (let second = first + 1; second < count; second += 1) {
				const dx = positions[first].x - positions[second].x;
				const dy = positions[first].y - positions[second].y;
				const distance = Math.hypot(dx, dy) || 0.01;
				const force = (k * k) / distance;
				const unitX = dx / distance;
				const unitY = dy / distance;
				displacement[first].x += unitX * force;
				displacement[first].y += unitY * force;
				displacement[second].x -= unitX * force;
				displacement[second].y -= unitY * force;
			}
		}

		for (const [first, second] of links) {
			const dx = positions[first].x - positions[second].x;
			const dy = positions[first].y - positions[second].y;
			const distance = Math.hypot(dx, dy) || 0.01;
			const force = (distance * distance) / k;
			const unitX = dx / distance;
			const unitY = dy / distance;
			displacement[first].x -= unitX * force;
			displacement[first].y -= unitY * force;
			displacement[second].x += unitX * force;
			displacement[second].y += unitY * force;
		}

		const temperature = 12 * (1 - iteration / iterations);
		for (let index = 0; index < count; index += 1) {
			const distance =
				Math.hypot(displacement[index].x, displacement[index].y) || 0.01;
			positions[index].x +=
				(displacement[index].x / distance) * Math.min(distance, temperature);
			positions[index].y +=
				(displacement[index].y / distance) * Math.min(distance, temperature);
		}
	}

	return new Map(nodes.map((node, index) => [node.id, positions[index]]));
}
