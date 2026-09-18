import { useState } from "react";
import { TitlebarPage } from "../../src/components/layout/TitlebarPage.tsx";

export function TitlebarScrollGeometry() {
	const [inset, setInset] = useState(80);
	const [loaded, setLoaded] = useState(false);
	return (
		<main className="h-screen bg-background text-foreground">
			<div className="flex gap-4 p-4">
				<button onClick={() => setLoaded(true)} type="button">
					Load page
				</button>
				<button
					onClick={() => setInset((value) => (value ? 0 : 80))}
					type="button"
				>
					Toggle clearance
				</button>
			</div>
			<section
				className="relative flex h-[500px] flex-col overflow-hidden"
				data-testid="geometry-frame"
			>
				<TitlebarPage inset={inset}>
					{loaded ? (
						<div
							className="flex h-full flex-col overflow-hidden"
							data-testid="outer-clip"
						>
							<div
								className="flex min-h-0 flex-1 flex-col overflow-hidden"
								data-testid="inner-clip"
							>
								<div
									className="scroll-fade min-h-0 flex-1 overflow-auto"
									data-testid="nested-scroll"
								>
									{Array.from({ length: 30 }, (_, i) => (
										<div className="h-16 shrink-0 p-4" key={i}>
											Row {i + 1}
										</div>
									))}
								</div>
							</div>
							<footer className="h-10 shrink-0" data-testid="footer">
								Fixed footer
							</footer>
						</div>
					) : (
						<p>Loading page</p>
					)}
				</TitlebarPage>
			</section>
		</main>
	);
}
