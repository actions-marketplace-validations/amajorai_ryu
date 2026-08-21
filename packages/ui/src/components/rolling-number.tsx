"use client";

import { formatCount } from "@ryu/ui/lib/number-format.ts";
import { useMotionValue, useSpring } from "motion/react";
import { useEffect, useRef } from "react";

interface RollingNumberProps {
	className?: string;
	duration?: number;
	prefix?: string;
	startValue?: number;
	suffix?: string;
	value: number;
}

export function RollingNumber({
	value,
	prefix = "",
	suffix = "",
	className,
	duration = 0.8,
	startValue = 0,
}: RollingNumberProps) {
	const ref = useRef<HTMLSpanElement>(null);
	const motionValue = useMotionValue(startValue);
	const springValue = useSpring(motionValue, {
		duration: duration * 1000,
		bounce: 0,
		stiffness: 100,
		damping: 30,
	});

	useEffect(() => {
		motionValue.set(value);
	}, [value, motionValue]);

	useEffect(
		() =>
			springValue.on("change", (latest: number) => {
				if (ref.current) {
					ref.current.textContent = `${prefix}${formatCount(Math.round(latest)) ?? "—"}${suffix}`;
				}
			}),
		[springValue, prefix, suffix]
	);

	// Initial render matching SSR to avoid hydration mismatch
	return (
		<span className={className} ref={ref}>
			{prefix}
			{formatCount(value) ?? "—"}
			{suffix}
		</span>
	);
}
