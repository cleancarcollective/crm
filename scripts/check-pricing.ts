import fs from "node:fs"; import path from "node:path";
function loadEnv(f:string){const p=path.join(process.cwd(),f);if(!fs.existsSync(p))return;for(const l of fs.readFileSync(p,"utf-8").split("\n")){const t=l.trim();if(!t||t.startsWith("#"))continue;const e=t.indexOf("=");if(e===-1)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;}}
loadEnv(".env.local");
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
const sb = getSupabaseAdminClient();
(async()=>{
  for (const slug of ["christchurch","wellington"]) {
    const {data:shop}=await sb.from("shops").select("id").eq("slug",slug).single();
    const {data}=await sb.from("pricing").select("service_name,size,price_ex_gst").eq("shop_id",shop!.id).order("service_name");
    console.log("\n=== "+slug+" ===");
    for (const r of data ?? []) console.log(`  ${r.service_name}  |  ${r.size ?? "(no size)"}  |  $${r.price_ex_gst}`);
  }
})();
