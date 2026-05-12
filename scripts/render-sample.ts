/**
 * Render a sample of the inside_out template exactly as the deliverability
 * test sends it, dump to stdout so we can spot any lingering URL.
 */
import fs from "node:fs"; import path from "node:path";
function loadEnv(f:string){const p=path.join(process.cwd(),f);if(!fs.existsSync(p))return;for(const l of fs.readFileSync(p,"utf-8").split("\n")){const t=l.trim();if(!t||t.startsWith("#"))continue;const e=t.indexOf("=");if(e===-1)continue;const k=t.slice(0,e).trim();let v=t.slice(e+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;}}
loadEnv(".env.local");
import { TEMPLATE_DEFAULTS } from "@/lib/autorespond/templateDefaults";
import { buildTemplateContext } from "@/lib/autorespond/templateRenderer";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
async function main() {
  const sb = getSupabaseAdminClient();
  const { data: shop } = await sb.from("shops").select("id").eq("slug","wellington").single();
  const { data: rows } = await sb.from("pricing").select("service_name,size,price_ex_gst").eq("shop_id",shop!.id);
  const pricing = new Map<string,number>();
  for (const r of (rows ?? []) as any[]) pricing.set(r.size?`${r.service_name}|${r.size}`:r.service_name, r.price_ex_gst ?? 0);
  const t = TEMPLATE_DEFAULTS.find((x)=>x.template_key==="inside_out")!;
  const ctx = buildTemplateContext("inside_out","Max","Toyota","Camry","medium" as any,pricing);
  console.log("== CONTEXT VARIABLES ==");
  for (const [k,v] of Object.entries(ctx)) console.log(`  {{${k}}} = ${JSON.stringify(v)}`);
  console.log("\n== RENDERED SUBJECT ==");
  console.log(t.subject.replace(/\{\{\s*(\w+)\s*\}\}/g,(_,k:string)=>(ctx as any)[k]??`{{${k}}}`));
  console.log("\n== RENDERED BODY ==");
  console.log(t.body_text.replace(/\{\{\s*(\w+)\s*\}\}/g,(_,k:string)=>(ctx as any)[k]??`{{${k}}}`));
}
main().catch((e)=>{console.error(e);process.exit(1)});
