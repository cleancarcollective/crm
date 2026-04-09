import { SettingsClient } from "@/components/dashboard/SettingsClient";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const DEFAULT_SHOP_SLUG = "christchurch";

// Default pricing rows shown if none set yet
const DEFAULT_PRICING_ROWS = [
  { service_name: "Deluxe Detail", size: "Small", price_ex_gst: 0 },
  { service_name: "Deluxe Detail", size: "Medium", price_ex_gst: 0 },
  { service_name: "Deluxe Detail", size: "Large", price_ex_gst: 0 },
  { service_name: "Deluxe Detail", size: "XL", price_ex_gst: 0 },
  { service_name: "Premium Detail", size: "Small", price_ex_gst: 0 },
  { service_name: "Premium Detail", size: "Medium", price_ex_gst: 0 },
  { service_name: "Premium Detail", size: "Large", price_ex_gst: 0 },
  { service_name: "Premium Detail", size: "XL", price_ex_gst: 0 },
  { service_name: "Deluxe Interior Detail", size: "Small", price_ex_gst: 0 },
  { service_name: "Deluxe Interior Detail", size: "Medium", price_ex_gst: 0 },
  { service_name: "Deluxe Interior Detail", size: "Large", price_ex_gst: 0 },
  { service_name: "Deluxe Interior Detail", size: "XL", price_ex_gst: 0 },
  { service_name: "Premium Interior Detail", size: "Small", price_ex_gst: 0 },
  { service_name: "Premium Interior Detail", size: "Medium", price_ex_gst: 0 },
  { service_name: "Premium Interior Detail", size: "Large", price_ex_gst: 0 },
  { service_name: "Premium Interior Detail", size: "XL", price_ex_gst: 0 },
  { service_name: "Deluxe Exterior Detail", size: "Small", price_ex_gst: 0 },
  { service_name: "Deluxe Exterior Detail", size: "Medium", price_ex_gst: 0 },
  { service_name: "Deluxe Exterior Detail", size: "Large", price_ex_gst: 0 },
  { service_name: "Deluxe Exterior Detail", size: "XL", price_ex_gst: 0 },
  { service_name: "Premium Exterior Detail", size: "Small", price_ex_gst: 0 },
  { service_name: "Premium Exterior Detail", size: "Medium", price_ex_gst: 0 },
  { service_name: "Premium Exterior Detail", size: "Large", price_ex_gst: 0 },
  { service_name: "Premium Exterior Detail", size: "XL", price_ex_gst: 0 },
  { service_name: "Ceramic Bronze (1 Year)", size: "Any", price_ex_gst: 0 },
  { service_name: "Ceramic Silver (2 Year)", size: "Any", price_ex_gst: 0 },
  { service_name: "Ceramic Gold (5 Year)", size: "Any", price_ex_gst: 0 },
  { service_name: "Paint Correction 1-Step", size: "Any", price_ex_gst: 0 },
  { service_name: "Paint Correction 2-Step", size: "Any", price_ex_gst: 0 },
];

export default async function SettingsPage() {
  const supabase = getSupabaseAdminClient();

  const { data: shop } = await supabase
    .from("shops")
    .select("id, name, slug")
    .eq("slug", DEFAULT_SHOP_SLUG)
    .maybeSingle();

  if (!shop) {
    return <main className="pageShell"><p>Shop not found.</p></main>;
  }

  const { data: settings } = await supabase
    .from("shop_settings")
    .select("auto_respond_enabled")
    .eq("shop_id", shop.id)
    .maybeSingle();

  const { data: pricingRaw } = await supabase
    .from("pricing")
    .select("service_name, size, price_ex_gst")
    .eq("shop_id", shop.id)
    .order("service_name")
    .order("size");

  // Merge DB rows into the default template (preserving all rows)
  const savedMap = new Map(
    (pricingRaw ?? []).map((r) => [`${r.service_name}|${r.size}`, Number(r.price_ex_gst)])
  );
  const pricingRows = DEFAULT_PRICING_ROWS.map((row) => ({
    ...row,
    price_ex_gst: savedMap.get(`${row.service_name}|${row.size}`) ?? row.price_ex_gst,
  }));

  return (
    <SettingsClient
      shopName={shop.name}
      autoRespondEnabled={settings?.auto_respond_enabled ?? false}
      pricingRows={pricingRows}
    />
  );
}
