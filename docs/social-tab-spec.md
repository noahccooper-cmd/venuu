# Social tab — production spec

Social = Venuu's events layer. Anyone signed in can post an event. It goes live for everyone immediately, labeled "Community". Venuu admins (Noah, Mike) Verify it (badge "Verified") or Deny it (removed, creator notified in-app). Partners (Sun Cruiser, Pinellas Run Club) have their own pages. Everything is simple: one page template, one back arrow, nothing clipped, every link works.

## Page template (every Social screen)

Rounded map box on top (~48% of the space under the header), normal scrolling page below, back arrow top-left except on Social home. No bottom sheets for navigation. Modals/forms are full-height scrollable sheets with a close button, respecting safe areas and the keyboard.

## Screens

1. **Social home** — box: globe with the Sun Cruiser sun rising behind the upper-right limb (only when the sun_cruiser brand row is active), labels for Knoxville / Tampa / St. Pete, green Pinellas Run Club medallion near St. Pete. Below: Sun Cruiser World card, Pinellas Run Club card, "This week" by city, "+ Post an event" button.
2. **City page** — box map fit to the city's events; filter medallions (All · Run Clubs · Pop-Ups · Nightlife · Community); list grouped Today / Tomorrow / weekday / Later.
3. **Event detail** — full page: photo if any, title, badge (Verified / Community / partner mark), date + time (or "Date TBA"), place + address, description, Directions (Apple Maps), partner links, Share, Report (non-owners), Edit/Delete (owner or admin), Verify/Deny (admins, Community events only).
4. **Sun Cruiser World** — SIMPLE: header (logo + "Sun Cruiser World"), box map recolored to their palette showing only their pins, city chips (Tampa · St. Pete · Knoxville), their events per city (real dates, or "Coming soon · Date TBA" cards), one row of links (Find Sun Cruiser near you · Website · Instagram), "21+ · Please drink responsibly". First entry per device: "Are you 21 or older?" Yes → enter, No → back to Social home. No carousels.
5. **Pinellas Run Club** — header (medallion + "Pinellas Run Club"), headline "The space for your pace.", line "All paces welcome. No sign-up needed. Better together.", box map of their upcoming runs, this month's runs list, links (Instagram · Website · Email), schedule line "Thursday evenings · Saturday mornings" (from brands.about; editable).
6. **Post an event** — form: title, category (Run Club / Pop-Up / Nightlife / Other), date + time or "Date TBA" (admins/hosts only), repeats weekly (hosts/admins only), location via Mapbox geocoding search with tap-to-drop-pin fallback, optional photo, description (280 chars), partner (hosts/admins only). First post requires accepting posting terms (no objectionable content, no zero-tolerance violations; violators removed). Submit → live with "Community" label, map flies to it.
7. **Admin review** — admin-only screen in Social: Community events newest first, reports queue, Verify / Deny / Ban poster.

## Navigation rules

Every screen has exactly one way back; back always restores the previous screen's scroll position and map camera; leaving Sun Cruiser World always restores normal map colors; switching tabs and returning resets Social to a clean state only if the app was backgrounded >30 min, otherwise keeps it. No dead links, no empty buttons, no TODO text visible to users.
