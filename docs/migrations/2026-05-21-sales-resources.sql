-- =============================================================================
-- Sales resources + service offerings.
--
-- Two new tables that power the in-CRM sales playbook:
--   * service_offerings - the catalogue of packages the sales rep can quote
--     from, with pricing per vehicle, "what's included" copy, and "when to
--     recommend" notes. shop_id is nullable; null rows apply to every shop.
--   * sales_resources - script + objection cards + opener/closing text. Same
--     shop_id semantics. Free-form markdown body. Edit history (updated_by)
--     so we can see who last refined a card.
--
-- Seed data is taken from docs/sales-kit/01-packages-by-popularity.md and
-- docs/sales-kit/03-objections.md. Rows are inserted with shop_id = NULL so
-- the same catalogue applies to both shops; a future shop-specific override
-- would insert a row with that shop's id and the API picks the more specific
-- match.
-- =============================================================================

-- service_offerings ----------------------------------------------------------

create table if not exists service_offerings (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references shops(id) on delete cascade,
  service_id text not null,
  display_name text not null,
  category text,
  popularity_rank integer,
  pricing_table jsonb,
  description text,
  what_included text,
  selling_points text,
  notes text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists service_offerings_shop_idx on service_offerings(shop_id);
create index if not exists service_offerings_rank_idx on service_offerings(popularity_rank);

-- sales_resources ------------------------------------------------------------

create table if not exists sales_resources (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references shops(id) on delete cascade,
  slug text not null,
  type text not null,
  title text not null,
  body_markdown text not null,
  display_order integer default 100,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references staff_users(id) on delete set null
);

create unique index if not exists sales_resources_slug_uniq
  on sales_resources(slug, coalesce(shop_id::text, 'global'));

create index if not exists sales_resources_type_idx
  on sales_resources(type, display_order);

-- ---------------------------------------------------------------------------
-- Seed: service_offerings
-- ---------------------------------------------------------------------------

-- Idempotent seed: skip if anything has been seeded already (any global row).
do $$
begin
if not exists (select 1 from service_offerings where shop_id is null) then
insert into service_offerings (shop_id, service_id, display_name, category, popularity_rank, pricing_table, description, what_included, selling_points, notes)
values
  (null, 'combination', 'Combination (Interior + Exterior)', 'Full Detail', 1,
    '{"Coupe / Hatchback": {"price": 350, "duration_minutes": 210}, "Sedan / Wagon": {"price": 370, "duration_minutes": 240}, "Small SUV": {"price": 390, "duration_minutes": 240}, "Large SUV / Ute": {"price": 420, "duration_minutes": 270}}'::jsonb,
    'The default for someone who wants the whole car sorted. Outside hand-wash, inside vacuum + plastics, windows, the works. Three to four hours on our end.',
    E'- Full exterior hand wash + dry\n- Interior vacuum + plastics detailed\n- Windows in and out\n- Wheels + tyres\n- 3-month paint + plastic sealant',
    E'Most customers actually want this even when they ask for "a detail" without specifying. Default to this unless they have a specific reason to upgrade or downsize.',
    'Edit this with the latest pitch line you find lands best on the phone.'),

  (null, 'deluxe-detail', 'Deluxe Detail', 'Full Detail', 2,
    '{"Coupe / Hatchback": {"price": 355, "duration_minutes": 210}, "Sedan / Wagon": {"price": 370, "duration_minutes": 240}, "Small SUV": {"price": 390, "duration_minutes": 240}, "Large SUV / Ute": {"price": 420, "duration_minutes": 270}}'::jsonb,
    'Same scope as the Combination but named and sold as a single package. Our most popular regular detail.',
    E'- Complete exterior hand wash + dry\n- Interior vacuum + plastics detailed\n- Wheel + tyre cleaning\n- Door jambs + windows\n- 3-month paint + plastic sealant',
    E'The safe default for a "regular detail" customer. About $370 for a sedan. Use this as the anchor price when someone asks "how much for a detail".',
    null),

  (null, 'premium-detail', 'Premium Detail', 'Full Detail', 3,
    '{"Coupe / Hatchback": {"price": 600, "duration_minutes": 360}, "Sedan / Wagon": {"price": 625, "duration_minutes": 360}, "Small SUV": {"price": 650, "duration_minutes": 390}, "Large SUV / Ute": {"price": 700, "duration_minutes": 420}}'::jsonb,
    'The deep clean / fresh start pass. Everything in the Deluxe plus clay bar, wax, engine bay, and interior shampoo.',
    E'- Everything in Deluxe Detail\n- Clay bar treatment\n- Spot paint correction (minor scratches)\n- Wax application + protection\n- Engine bay cleaning\n- Interior shampoo treatment',
    E'Best fit when:\n- It has been over six months since the car was last properly detailed\n- The customer is prepping the car for sale\n- The car has visible swirl marks or contamination',
    null),

  (null, 'exterior-only', 'Exterior Only', 'Exterior Only', 4,
    '{"Deluxe Exterior Hand Wash": {"price": 116, "duration_minutes": 90}, "Premium Exterior": {"price": 365, "duration_minutes": 210}}'::jsonb,
    'For customers who only want the outside done. Two sub-options.',
    E'- **Deluxe Exterior Hand Wash** ($116 avg): basic wash + 3-month sealant\n- **Premium Exterior** ($365 avg): includes clay bar + wax',
    E'Upsell line: "If you are getting the outside done, our Deluxe Detail does the inside too for an extra $250-ish. Most customers find the value is there."',
    null),

  (null, 'interior-only', 'Interior Only', 'Interior Only', 5,
    '{"Deluxe Interior": {"price": 256, "duration_minutes": 150}, "Premium Interior": {"price": 404, "duration_minutes": 240}}'::jsonb,
    'For customers who only want the inside done. Two sub-options.',
    E'- **Deluxe Interior** ($256 avg): vacuum, plastics, windows\n- **Premium Interior** ($404 avg): shampoo carpets + seats, deep clean, stain extraction',
    E'Recommend Premium Interior over Deluxe when:\n- Pets, kids, construction, or farm work\n- Visible stains, odours, or mould\n- The interior has not been done in 12+ months',
    null),

  (null, 'premium-interior', 'Premium Interior', 'Interior Only', 6,
    '{"Coupe / Hatchback": {"price": 379, "duration_minutes": 210}, "Sedan / Wagon": {"price": 395, "duration_minutes": 240}, "Small SUV": {"price": 412, "duration_minutes": 240}, "Large SUV / Ute": {"price": 430, "duration_minutes": 270}}'::jsonb,
    'Full interior restoration: shampoo carpets and seats, deep clean every surface, stain and odour extraction.',
    E'- Shampoo carpets + seats\n- Deep clean every surface\n- Stain + odour extraction\n- Plastics dressed\n- Windows in and out',
    E'The go-to package for heavy interior soiling (pets, kids, farm, construction).',
    null),

  (null, 'ceramic-coating', 'Ceramic Coating (Bronze / Silver / Gold)', 'Ceramic', 7,
    '{"Bronze (1 year)": {"price_from": 600}, "Silver (2 year)": {"price_from": 850}, "Gold (5 year)": {"price_from": 1053}}'::jsonb,
    'Long-term paint protection. Three tiers by warranty length.',
    E'- Bronze: 1-year warranty\n- Silver: 2-year warranty\n- Gold: 5-year warranty (avg $1,053 standalone)',
    E'Customers asking about coatings should ALWAYS book a consultation first. The price depends on paint condition.\n\nPitch: "Coating is a great option, but we always want to see the car first to give you an honest quote. The price varies a lot based on paint condition. Want me to book you in for a 15-minute consultation? It is free."',
    'Do NOT quote a fixed price over the phone. Always book a consult.'),

  (null, 'paint-correction', 'Paint Correction', 'Paint Correction', 8,
    '{"1-Step": {"price_from": 550}, "2-Step": {"price_from": 800, "price_to": 1500}}'::jsonb,
    'Machine polish to remove swirl marks, light scratches, and oxidation.',
    E'- 1-Step: $550 (single Sedan reference)\n- 2-Step: $800-$1500+, varies by paint condition\n- Often combined with Gold ceramic for the premium combo (~$1,825)',
    E'Same rule as ceramics: book a quote visit, do not quote a fixed price on the phone.',
    null);
end if;
end $$;

-- ---------------------------------------------------------------------------
-- Seed: sales_resources
-- ---------------------------------------------------------------------------

do $$
begin
if not exists (select 1 from sales_resources where shop_id is null) then
insert into sales_resources (shop_id, slug, type, title, body_markdown, display_order)
values
  (null, 'script', 'script', 'Cold-call script',
E'Drop your call script here. Markdown supported.\n\nUse this as your live working document. The opener and closing patterns from the playbook are loaded as separate cards under [Objections](/sales/objections).\n\n## Quick reminders\n\n- Open with the 30-second opener (see Openers).\n- Two specific times to close, never an open question.\n- Mark a clear "no" as lost so we stop chasing.',
    10),

  (null, 'opener-cold-call', 'opener', 'The 30-second opener',
E'> "Hi, is that {first_name}? This is {your_name} calling from Clean Car Collective. You got a quote from us a {weeks_ago} weeks ago for a detail on your {vehicle}. I wanted to check in. Was the timing just off, or did you sort something else? Either way I will not hold you up."\n\nThe "I will not hold you up" line is the magic line. It gives them an out and makes you sound like a person, not a script.\n\n**If they are driving or busy:** "No worries, when is a better time to catch you? I will call back."',
    20),

  (null, 'objection-forgot', 'objection-card', 'I forgot all about it / been busy',
E'Most common. They are warm, just need a nudge.\n\n> "Yeah, life gets in the way. The car still need a sort, or has someone else done it?"\n\nIf yes: "Sweet, want me to lock in a time this week? I have got Thursday afternoon or Saturday morning."',
    30),

  (null, 'objection-went-elsewhere', 'objection-card', 'I went somewhere else',
E'That is a useful "no". Flip them to lost so we stop chasing them.\n\n> "All good. Were you happy with the result? If not, give us a shout next time, we would love to win you back. Otherwise I will close this off so we do not keep nudging you."\n\n**Mark them as lost in the CRM.** Note who they went with if they mention it.',
    40),

  (null, 'objection-price', 'objection-card', 'Price was too high',
E'Listen for whether it is "too high vs competitors" or "too high for what I can spend right now".\n\n**Too high vs competitors:**\n\n> "Fair enough. What were the other quotes coming in at? A lot depends on what is included. The {their_service} we quoted includes {2-3 key features}. If you are comparing to a $150 hand wash, that is a different service."\n\nIf they had a genuinely comparable lower quote, offer the 5% booked-today discount.\n\n**Can not afford right now:**\n\n> "All good. Did you want me to flag it on my calendar to check back in 4-6 weeks? Or is it more a try-us-next-year kind of thing?"\n\nThen mark callback in the CRM.',
    50),

  (null, 'objection-doesnt-need', 'objection-card', 'I do not think the car needs that much',
E'Downsell, do not lose them.\n\n> "Yeah, fair point. If you have kept it pretty tidy, the Deluxe might be enough. That is $370 for a sedan: exterior wash, interior vacuum, plastics, windows, three-month sealant. Save the Premium for once-a-year. Want me to book the Deluxe in?"',
    60),

  (null, 'objection-worth-it', 'objection-card', 'How do I know it will be worth it',
E'Trust play.\n\n> "Totally get it. We are {Christchurch / Wellington} based, we have been at it for {X} years, we have got Google reviews you can check. We do a free 15-minute consultation if you want to meet the team before committing. No obligation, just a look."',
    70),

  (null, 'objection-diy', 'objection-card', 'I will do it myself / friend will do it',
E'Do not fight this. Most people who say it actually will, but they might not stick to it.\n\n> "All good. If it turns into more of a job than expected, you have got my number. Want me to leave the file open or close it off?"',
    80),

  (null, 'objection-send-quote', 'objection-card', 'Just send me a quote, I will think about it',
E'You already sent them one. Get specific.\n\n> "We sent you one a few weeks back. Was something missing from it, or was it more that the timing was off? Happy to walk through it while I have got you."\n\nIf they want a fresh quote, take their requirements again, quote on the call, book the slot.',
    90),

  (null, 'objection-region', 'objection-card', 'Do you cover [different suburb / region]?',
E'**Christchurch shop:** covers all of Christchurch + Selwyn + Waimakariri. Anywhere else, transfer to in-store.\n\n**Wellington shop:** covers Wellington City, Lower Hutt, Porirua. Upper Hutt + Kapiti is in-store only.\n\nMobile pricing same as in-store. Confirm parking + power before booking mobile.',
    100),

  (null, 'closing-two-options', 'closing', 'Close on two specific times',
E'Once they sound interested:\n\n> "Sweet. What works best, this week, next week, or further out? Got Thursday at 9am or Saturday 11am, which is better for you?"\n\nAlways offer **two specific times**, not "what works for you". Two choices = decision, one open question = stall.\n\nOnce they pick, use the **Book this customer** button on their profile page. The form pre-fills with everything you already have. Confirm details out loud as you fill them in.',
    110);
end if;
end $$;
