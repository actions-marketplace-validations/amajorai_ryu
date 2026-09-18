import type { LanguagePack } from "@ryu/i18n/core";
import { I18nProvider } from "@ryu/i18n/react";
import { I18nDirectionProvider } from "@ryu/ui/components/direction.tsx";
import { useEffect, useState } from "react";
import { watchLanguagePacks } from "../hooks/watch-language-packs.ts";

/** The Island is a separate Electron renderer, so it needs its own provider
 * and a main-process catalog read rather than inheriting Desktop's context. */
export function IslandI18nProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const [packs, setPacks] = useState<LanguagePack[]>([]);

	useEffect(() => watchLanguagePacks(setPacks), []);

	return (
		<I18nProvider
			initialLocale={
				typeof navigator === "undefined" ? undefined : navigator.language
			}
			packs={packs}
		>
			<I18nDirectionProvider>{children}</I18nDirectionProvider>
		</I18nProvider>
	);
}
