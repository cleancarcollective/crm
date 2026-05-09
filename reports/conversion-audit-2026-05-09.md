# Conversion audit — 2026-05-09

Every lead from the last 90 days, with the booking we'd credit to it (if any). A lead is credited as "booked" if a booking for the same contact was created within 30 days after the lead.

Use this to spot-check the conversion-rate report:
- Look at booked rows. Does the contact name + lead source + booking date line up with what you remember?
- Look at flagged rows (⚠️ / 📞 / ❓). These are edge cases that might over- or under-count.
- Look at unbooked rows. Are there any contacts you're sure you booked? If yes, the contact_id linkage may be broken.

## Summary

| Shop | Leads (90d) | Booked | Ambiguous (multi-lead contact) | Orphan (no contact) |
|---|---:|---:|---:|---:|
| Clean Car Collective Christchurch | 84 | 3 | 2 | 0 |
| Clean Car Collective Wellington | 13 | 0 | 0 | 0 |

## Clean Car Collective Christchurch

### Booked (3)

| Lead date | Source | Contact | Email sent? | Booking date | Lag | Booking status | Price | Service | Flags |
|---|---|---|---|---|---:|---|---:|---|---|
| 24 Apr 12:59 | website-lead-form | Max Tebbs (tebbs.max@gmail.com) | ✓ 24 Apr 12:59 | 27 Apr 08:48 | 2.8d | confirmed | $105 | Interior only | ℹ️ contact has 6 leads — only this lead credited (most recent before booking) |
| 11 Apr 12:39 | website-lead-form | Max Tebbs (tebbs.max@gmail.com) | ✓ 11 Apr 12:39 | 21 Apr 09:02 | 9.8d | confirmed | $95 | Exterior only | ℹ️ contact has 6 leads — only this lead credited (most recent before booking) |
| 6 Apr 19:53 | website-lead-form | Grace Hogan (gracehogan14@outlook.com) | — | 13 Apr 07:57 | 6.5d | confirmed | $650 | Inside and out package options | 📞 no email — likely phone-in or auto-respond skipped |

### Unbooked (81)

| Lead date | Source | Contact | Email sent? | Service | Flags |
|---|---|---|---|---|---|
| 9 May 13:10 | website-lead-form | Richard James Gilbert (gilbie@outlook.com) | ✓ 9 May 13:10 | Inside and out package options |  |
| 9 May 07:43 | website-lead-form | Jonathan Campbell (iamjono1@gmail.com) | ✓ 9 May 07:43 | Inside and out package options |  |
| 8 May 14:31 | website-lead-form | Sarah Freeman (sarahfreemannz@outlook.com) | ✓ 8 May 14:31 | Inside and out package options |  |
| 7 May 20:32 | website-lead-form | Elias Falconer (elias.falconer@outlook.co.nz) | ✓ 7 May 20:32 | Inside and out package options |  |
| 7 May 12:33 | website-lead-form | Ben Simpson (ben.simpson@thermosash.co.nz) | ✓ 7 May 12:33 | Interior only |  |
| 6 May 13:43 | website-lead-form | Andrei cotiga (ac@eliotsinclair.co.nz) | ✓ 6 May 13:43 | Interior only |  |
| 6 May 06:39 | website-lead-form | Salote (salote_kasaiverata@yahoo.com) | ✓ 6 May 06:39 | Inside and out package options |  |
| 4 May 12:25 | website-lead-form | Dan Coughlan (danielcoughlan910@gmail.com) | ✓ 4 May 12:25 | Inside and out package options |  |
| 2 May 20:24 | website-lead-form | Nav singh (nav0302@gmail.com) | ✓ 2 May 20:24 | Ceramic coating |  |
| 1 May 12:57 | website-lead-form | Millie Owen (owenmillie@gmail.com) | ✓ 1 May 12:57 | Inside and out package options |  |
| 1 May 09:22 | website-lead-form | Bex Welsh (rebekah.welsh@live.com) | ✓ 1 May 09:22 | Ceramic coating |  |
| 30 Apr 12:49 | website-lead-form | Oliver Dambeck (olivarius@xtra.co.nz) | ✓ 30 Apr 12:49 | Ceramic coating |  |
| 29 Apr 12:44 | website-lead-form | ethan harris (ethanharris383@gmail.com) | ✓ 29 Apr 12:44 | Inside and out package options |  |
| 29 Apr 07:42 | website-lead-form | Isaac Oke (destination.moon95@gmail.com) | ✓ 29 Apr 07:42 | Inside and out package options |  |
| 28 Apr 16:38 | website-lead-form | Chivala Heal (chivheal@gmail.com) | ✓ 28 Apr 16:38 | Ceramic coating |  |
| 28 Apr 12:46 | website-lead-form | Jake Hynd (jthynd@gmail.com) | ✓ 28 Apr 12:46 | Inside and out package options |  |
| 28 Apr 10:31 | website-lead-form | Charlotte Jane Baxter (baxtercjb@hotmail.com) | ✓ 28 Apr 10:31 | Inside and out package options |  |
| 27 Apr 20:31 | website-lead-form | Jennine Percival (betthebarmaid@hotmail.com) | ✓ 27 Apr 20:31 | Inside and out package options |  |
| 26 Apr 18:59 | website-lead-form | Paul Stead (paul@bgcproperties.co.nz) | ✓ 26 Apr 18:59 | Inside and out package options |  |
| 25 Apr 21:19 | website-lead-form | Peter Gee (peter.gee@xtra.co.nz) | ✓ 25 Apr 21:19 | Other |  |
| 25 Apr 06:00 | website-lead-form | Cian Ryan (cian.ryan@harcourts.co.nz) | ✓ 25 Apr 06:00 | Inside and out package options |  |
| 24 Apr 23:56 | website-lead-form | James (jameswkatene@gmail.com) | ✓ 24 Apr 23:56 | Inside and out package options |  |
| 24 Apr 07:30 | website-lead-form | Max Tebbs (tebbs.max@gmail.com) | ✓ 24 Apr 07:30 | Ceramic coating |  |
| 24 Apr 07:13 | website-lead-form | Max Tebbs (tebbs.max@gmail.com) | ✓ 24 Apr 07:13 | Ceramic coating |  |
| 24 Apr 05:15 | website-lead-form | Max (max@cleancarcollective.co.nz) | ✓ 24 Apr 05:15 | Inside & Out |  |
| 24 Apr 05:15 | website-lead-form | Statuscheck (statuscheck@example.com) | ✓ 24 Apr 05:15 | Inside & Out |  |
| 22 Apr 08:19 | website-lead-form | Max Tebbs (tebbs.max@gmail.com) | ✓ 22 Apr 08:19 | Interior only |  |
| 22 Apr 08:07 | website-lead-form | Max Tebbs (tebbs.max@gmail.com) | ✓ 22 Apr 08:07 | Deluxe Detail |  |
| 22 Apr 08:04 | website-lead-form | DeployCheck (deploycheck@example.com) | ✓ 22 Apr 08:04 | Deluxe Detail |  |
| 22 Apr 07:54 | website-lead-form | TestAutoRespond (testauto@example.com) | ✓ 22 Apr 07:54 | Full detail |  |
| 21 Apr 16:46 | website-lead-form | Bharath Sreekumar (bharathsreekumarpillai@gmail.com) | ✓ 21 Apr 16:46 | Other |  |
| 21 Apr 12:48 | website-lead-form | Stella Kees (svkees09@gmail.com) | ✓ 21 Apr 12:48 | Exterior only |  |
| 21 Apr 11:57 | website-lead-form | Pratik Navani (Pratik.Navani@rnz.co.nz) | ✓ 21 Apr 11:57 | Inside and out package options |  |
| 20 Apr 06:09 | website-lead-form | Palmer David (davedons67@gmail.com) | ✓ 20 Apr 06:09 | Inside and out package options |  |
| 20 Apr 06:07 | website-lead-form | Palmer David (davedons67@gmail.com) | ✓ 20 Apr 06:07 | Inside and out package options |  |
| 19 Apr 13:03 | website-lead-form | Ann Sanderson (annsanderson5@yahoo.co.uk) | ✓ 19 Apr 13:03 | Inside and out package options |  |
| 17 Apr 10:46 | website-lead-form | Jaff Menguito (jaffluimenguito2@gmail.com) | ✓ 17 Apr 10:46 | Interior only |  |
| 16 Apr 13:39 | website-lead-form | Praveen (praveenbabu20@yahoo.com) | ✓ 16 Apr 13:39 | Inside and out package options |  |
| 16 Apr 10:40 | website-lead-form | Zachary Lee (jhzlee03@gmail.com) | ✓ 16 Apr 10:40 | Inside and out package options |  |
| 15 Apr 17:25 | website-lead-form | Edward Tokauea (edtokauea0271@gmail.com) | ✓ 15 Apr 17:25 | Interior only |  |
| 15 Apr 09:00 | website-lead-form | Yash Sharma (yash@islesconstruction.co.nz) | ✓ 15 Apr 09:00 | Inside and out package options |  |
| 14 Apr 22:37 | website-lead-form | Geoff Lester (geofflester97@gmail.com) | ✓ 14 Apr 22:37 | Inside and out package options |  |
| 14 Apr 14:37 | website-lead-form | Lukas Acuña (lukas.real45@gmail.com) | ✓ 14 Apr 14:37 | Exterior only |  |
| 13 Apr 17:12 | website-lead-form | James Webster (j.webster@outlook.com) | ✓ 13 Apr 17:12 | Inside and out package options |  |
| 13 Apr 13:48 | website-lead-form | Meagan Courreges (meagancourreges@gmail.com) | ✓ 13 Apr 13:48 | Interior only |  |
| 13 Apr 10:30 | website-lead-form | Howard Marshall (hja.marshall@gmail.com) | ✓ 13 Apr 10:30 | Ceramic coating |  |
| 12 Apr 08:43 | website-lead-form | Max Tebbs (Max@cleancarcollective.co.nz) | ✓ 12 Apr 08:43 | Ceramic coating |  |
| 12 Apr 08:19 | website-lead-form | Aaa (bbb) | ✓ 12 Apr 08:19 | Interior only |  |
| 11 Apr 13:14 | website-lead-form | Update (updatetest@example.com) | ✓ 11 Apr 13:14 | Inside & Out |  |
| 11 Apr 13:11 | website-lead-form | Trace (trace@example.com) | ✓ 11 Apr 13:11 | Inside & Out |  |
| 11 Apr 13:09 | website-lead-form | Debugfinal (debugfinal@example.com) | ✓ 11 Apr 13:09 | Inside & Out |  |
| 11 Apr 13:06 | website-lead-form | Parallel (parallel@example.com) | ✓ 11 Apr 13:06 | Inside & Out |  |
| 11 Apr 13:03 | website-lead-form | Final (finaltest@example.com) | ✓ 11 Apr 13:03 | Inside & Out |  |
| 11 Apr 12:59 | website-lead-form | Diag (diag@example.com) | ✓ 11 Apr 12:59 | Inside & Out |  |
| 11 Apr 12:53 | website-lead-form | Localtest (localtest@example.com) | — | Inside & Out |  |
| 11 Apr 12:50 | website-lead-form | Debug (debug@example.com) | ✓ 11 Apr 12:50 | Inside & Out |  |
| 11 Apr 12:48 | website-lead-form | Test (test@example.com) | ✓ 11 Apr 12:48 | Inside & Out |  |
| 10 Apr 10:32 | website-lead-form | Morghan Gourlie (morgie.gourlie@gmail.com) | ✓ 10 Apr 10:32 | Inside and out package options |  |
| 9 Apr 16:38 | website-lead-form | Issara Sarakanee (pokiezpk@gmail.com) | ✓ 9 Apr 16:38 | Ceramic coating |  |
| 9 Apr 12:45 | website-lead-form | Noah Whitehead (noahawhitehead@gmail.com) | ✓ 9 Apr 12:45 | Inside and out package options |  |
| 9 Apr 07:46 | website-lead-form | Julie Hislop (Julieahislop@gmail.com) | ✓ 9 Apr 07:46 | Inside and out package options |  |
| 8 Apr 12:48 | website-lead-form | Graham Heath (graham.the.heath@gmail.com) | — | Inside and out package options |  |
| 8 Apr 10:47 | website-lead-form | June Amornsirinapha (june624nz@gmail.com) | — | Interior only |  |
| 8 Apr 10:44 | website-lead-form | Pearl Abenoja (pearl.abenoja@yahoo.com) | — | Inside and out package options |  |
| 8 Apr 10:03 | website-lead-form | Tom Briggs (tom@onpointfuture.co.nz) | — | Inside and out package options |  |
| 8 Apr 04:09 | website-lead-form | Max Tebbs (hello@cleancarcollective.co.nz) | ✓ 12 Apr 11:27 | Interior only |  |
| 7 Apr 17:30 | website-lead-form | Natalie Meredith (natalie.meredith@hotmail.com) | — | Inside and out package options |  |
| 7 Apr 15:12 | website-lead-form | Sadie Ross (shmelor@gmail.com) | — | Interior only |  |
| 7 Apr 14:53 | website-lead-form | Jesse Tomlinson (jessewptomlinson@outlook.com) | — | Inside and out package options |  |
| 7 Apr 06:44 | website-lead-form | Divek Thapar (Thapardivek10@gmail.com) | — | Inside and out package options |  |
| 6 Apr 17:15 | website-lead-form | Ryan Strijbis (theryannz@gmail.com) | — | Interior only |  |
| 6 Apr 14:24 | website-lead-form | Max Tebbs (hello@cleancarcollective.co.nz) | — | Exterior only |  |
| 6 Apr 14:20 | bridge-after-redeploy | Max Tebbs (hello@cleancarcollective.co.nz) | — | Interior only |  |
| 6 Apr 14:19 | bridge-postfix-test | Max Tebbs (hello@cleancarcollective.co.nz) | — | Interior only |  |
| 6 Apr 14:17 | website-lead-form | Max Tebbs (hello@cleancarcollective.co.nz) | — | Interior only |  |
| 6 Apr 14:13 | bridge-log-test | Max Tebbs (hello@cleancarcollective.co.nz) | — | Interior only |  |
| 6 Apr 14:12 | bridge-test | Max Tebbs (hello@cleancarcollective.co.nz) | — | Interior only |  |
| 6 Apr 14:10 | website-lead-form | Max Tebbs (hello@cleancarcollective.co.nz) | — | Interior only |  |
| 6 Apr 13:52 | website-lead-form | Max Tebbs (hello@cleancarcollective.co.nz) | — | Exterior only |  |
| 6 Apr 13:50 | website-lead-form | Max Tebbs (hello@cleancarcollective.co.nz) | — | Exterior only |  |
| 6 Apr 13:48 | website-lead-form | Max Tebbs (hello@cleancarcollective.co.nz) | — | — |  |

## Clean Car Collective Wellington

### Booked (0)

_None._

### Unbooked (13)

| Lead date | Source | Contact | Email sent? | Service | Flags |
|---|---|---|---|---|---|
| 9 May 14:55 | website-lead-form | Eleanor Carr (Notaletterbox@gmail.com) | ✓ 9 May 14:55 | Inside and out package options |  |
| 9 May 13:37 | website-lead-form | Ana Kamenica (ana.kmnc@gmail.com) | ✓ 9 May 13:37 | Interior only |  |
| 9 May 10:53 | website-lead-form | Sophie Apostolaakis (thegreekfoodtruck@gmail.com) | ✓ 9 May 10:53 | Inside and out package options |  |
| 9 May 08:21 | website-lead-form | Samuel Bryan (samuel.j.bryan@gmail.com) | ✓ 9 May 08:21 | Paint protection film |  |
| 9 May 03:50 | website-lead-form | Shaun Preston (shaun@shaunpreston.com) | ✓ 9 May 03:50 | Paint protection film |  |
| 8 May 21:25 | website-lead-form | Samuel Smith (samuelsmith7133@gmail.com) | ✓ 8 May 21:25 | Inside and out package options |  |
| 8 May 14:31 | website-lead-form | Cole Johnston (colejohnston101@gmail.com) | ✓ 8 May 14:31 | Interior only |  |
| 8 May 13:23 | website-lead-form | Jess Escaip (jess_escaip@hotmail.com) | ✓ 8 May 13:23 | Inside and out package options |  |
| 8 May 11:27 | website-lead-form | Richard Charm (richard_nz1@yahoo.com) | ✓ 8 May 11:27 | Inside and out package options |  |
| 8 May 07:30 | website-lead-form | Kate Murray (kalizmu@gmail.com) | ✓ 8 May 07:30 | Inside and out package options |  |
| 8 May 05:27 | website-lead-form | Philip Smith (philipsmith290@gmail.com) | ✓ 8 May 05:27 | Inside and out package options |  |
| 7 May 10:03 | website-lead-form | Max Tebbs (hello@cleancarcollective.co.nz) | ✓ 7 May 10:03 | Interior only |  |
| 7 May 09:12 | website-lead-form | Max Tebbs (hello@cleancarcollective.co.nz) | ✓ 7 May 09:12 | Inside & Out |  |

---

*Generated 2026-05-09T04:06:14.890Z from 90d of leads. Conversion window: 30d.*