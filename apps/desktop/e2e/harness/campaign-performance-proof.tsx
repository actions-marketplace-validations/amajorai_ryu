import { createRoot } from "react-dom/client";
import { CampaignOffer } from "../../../web/src/components/campaign/campaign-offer.tsx";
import "../../src/index.css";
const campaign = {
	slug: "preview",
	label: "Campaign preview",
	description: "Example campaign offer.",
	grantMicroUsd: 50_000_000,
	poolLabel: "Ryu Frontier",
	seatLimit: 100,
	claimedCount: 10,
	seatsRemaining: 90,
};
createRoot(document.getElementById("root")!).render(
	<main className="min-h-screen bg-background p-10 text-foreground">
		<CampaignOffer
			campaign={campaign}
			ladder="proof"
			returnPath="/campaign"
			signedIn={false}
		/>
	</main>
);
