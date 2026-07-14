/**
 * Upsell preset catalog. These mirror the booking form's ADD_ONS
 * (New-Booking-System/constants.ts) so an accepted upsell appends the
 * exact same add-on object the form uses - price, label and duration
 * stay consistent everywhere. Prices are ex-GST, in dollars (the
 * booking form works in dollars); we store cents on the item.
 *
 * `quickPick` flags the ones staff commonly spot during a detail, so
 * the panel can surface them first. Any add-on can still be chosen, and
 * a Custom option covers anything not listed.
 */

export type UpsellPreset = {
  id: string;
  name: string;
  price: number; // ex-GST dollars
  durationMin: number;
  quickPick: boolean;
};

export const UPSELL_CATALOG: UpsellPreset[] = [
  { id: "scratch-removal", name: "Scratch & scuff removal", price: 75, durationMin: 30, quickPick: true },
  { id: "pet-hair", name: "Excess pet hair removal", price: 80, durationMin: 45, quickPick: true },
  { id: "headlight", name: "Headlight restoration", price: 120, durationMin: 45, quickPick: true },
  { id: "shampoo-seats", name: "Shampoo seats", price: 60, durationMin: 24, quickPick: true },
  { id: "shampoo-carpet", name: "Shampoo carpet & floor mats", price: 60, durationMin: 24, quickPick: true },
  { id: "engine-bay", name: "Engine Bay Detail", price: 55, durationMin: 30, quickPick: true },
  { id: "ceramic-sealant", name: "6 Month Ceramic Sealant", price: 100, durationMin: 30, quickPick: true },
  { id: "headliner", name: "Headliner cleaning", price: 80, durationMin: 36, quickPick: true },
  { id: "underbody", name: "Underbody clean", price: 90, durationMin: 30, quickPick: false },
  { id: "leather-ceramic-seat", name: "Leather Ceramic Coating (Per Seat)", price: 75, durationMin: 30, quickPick: false },
  { id: "leather-ceramic-5", name: "Leather Ceramic Coating (5 Seats)", price: 300, durationMin: 90, quickPick: false },
  { id: "fabric-ceramic-row", name: "Fabric Ceramic Coating (Per Row)", price: 125, durationMin: 45, quickPick: false },
  { id: "glass-ceramic-partial", name: "Glass Ceramic (Windshield & Front 2)", price: 150, durationMin: 45, quickPick: false },
  { id: "glass-ceramic-full", name: "Glass Ceramic Coating (Full Car)", price: 250, durationMin: 60, quickPick: false },
  { id: "kids-seat", name: "Kids car seat shampoo", price: 30, durationMin: 12, quickPick: false },
];

export function presetById(id: string | null | undefined): UpsellPreset | null {
  if (!id) return null;
  return UPSELL_CATALOG.find((p) => p.id === id) ?? null;
}
