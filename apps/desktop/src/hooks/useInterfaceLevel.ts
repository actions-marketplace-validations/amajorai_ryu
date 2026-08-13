// apps/desktop/src/hooks/useInterfaceLevel.ts
//
// React binding for THE interface-level store (`@/src/lib/interface-level.ts`).
// The store itself is pure so the ladder's rules can be imported — and tested —
// without React; this file is only the `useSyncExternalStore` wiring, in the
// same shape as useAgentRowStyle, so the account menu's slider, the composer and
// the Appearance tab all re-render off one module-level store rather than a copy
// each (a second store sharing the key would not re-render in the writing
// document, since `storage` never fires there).

import { useSyncExternalStore } from "react";
import {
	getInterfaceLevelServerSnapshot,
	getInterfaceLevelSnapshot,
	type InterfaceLevel,
	subscribeInterfaceLevel,
} from "@/src/lib/interface-level.ts";

/** Subscribe to the current interface level. */
export function useInterfaceLevel(): InterfaceLevel {
	return useSyncExternalStore(
		subscribeInterfaceLevel,
		getInterfaceLevelSnapshot,
		getInterfaceLevelServerSnapshot
	);
}
