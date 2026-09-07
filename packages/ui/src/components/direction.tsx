"use client";

import {
	DirectionProvider,
	useDirection,
} from "@base-ui/react/direction-provider";
import { useI18n } from "@ryu/i18n/react";
import type { ReactNode } from "react";

export { DirectionProvider, useDirection };

/** Bridge Ryu's active language pack into Base UI's direction context. */
export function I18nDirectionProvider({ children }: { children: ReactNode }) {
	const { direction } = useI18n();
	return (
		<DirectionProvider direction={direction}>{children}</DirectionProvider>
	);
}
