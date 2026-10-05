---
vehicle_type: both
topic: tires
summary: The absolute tire pressure envelope published by tire makers for track and road use, with a source for every figure, and why a value outside it is not a setup change.
---

# Tire pressure limits

`pressure-basics.md` is about changes: 0.5 psi steps, cold-to-hot deltas, one axle at a time. It deliberately gives no absolute target, because the right pressure depends on the chassis, the tire, the rider or driver weight and the venue, and the manufacturer and tire supplier are the authority on it. This document is the other half: the outermost figures those makers actually publish, so that a number far outside all of them can be recognised for what it is. A value outside this envelope is not a setup change. It is a tire operating outside anything its maker has published for it, and the advice for it is to come back inside the envelope before changing anything else.

The envelope is not a recommendation. It is the lowest cold minimum and the highest cold maximum found across the cited tables, so it is far wider than any one tire's window. A pressure inside the envelope can still be wrong for a particular tire; a pressure outside it is wrong for every tire cited here. Hot pressures run 3-6 psi above cold on a track tire, so a hot reading a few psi above a cold maximum is normal and is not what this document is about.

## Motorcycle envelope: 16 to 42 psi

The lowest figure any cited maker publishes for a motorcycle tire is 16 psi, and the highest is 42 psi.

Pirelli, DIABLO Superbike pressure table (https://www.pirelli.com/tyres/en-ww/motorcycle/catalogue/product/diablo-superbike):

- 120/70 R17 front: cold 2.1-2.2 bar (30-32 psi), hot 2.2-2.5 bar (32-36 psi)
- 160/60 to 200/65 R17 rear: cold 1.6-1.8 bar (23-26 psi), hot 1.7-1.9 bar (25-28 psi)
- 120/80-10 rear (minimoto): cold 1.1-1.2 bar (16-17 psi)

Dunlop Racing, Sportmax Slick and KR pressure table (https://www.dunlopracing.com/product/slicks/):

- 110/70 R17 front: cold 32-36 psi, hot 34-38 psi
- 180/60 to 200/60 R17 rear: cold 19-22 psi, hot 22-27 psi

Dunlop Europe, track tyre pressure information (https://www.dunlop-moto.com/en_gb/safety-and-technology/tire-pressure-information.html):

- KR108 slick rear: cold 1.5-1.7 bar, minimum 1.4 bar (20 psi)
- SportSmart TT 170/60 ZR17 rear: cold 2.7-2.9 bar (39-42 psi)

Dunlop Motorcycle Tires, care and maintenance (https://www.dunlopmotorcycletires.com/about/care/):

- never exceed the maximum indicated on the tire sidewall; hard cornering, passengers and sustained high speed call for higher pressures only up to that figure, and under-inflation brings imprecise cornering, higher running temperatures, fatigue cracking and eventual failure

For a 17-inch sportbike tire the published floor is 19 psi cold (Dunlop rear slicks); the 16 psi figure is a 10-inch minimoto rear. The 42 psi ceiling is the highest cold pressure Dunlop recommends for any road tire size and matches the 290 kPa maximum branded on common sport sizes.

## Car envelope: 17 to 51 psi

The lowest figure any cited maker publishes for a car track tire is 17 psi, and the highest pressure a passenger tire sidewall is branded with is 51 psi.

Toyo Tires UK, Proxes R888R set-up advice (https://www.toyo.co.uk/page/index/identifier/set-up-advice):

- very light car (under 800 kg): cold 17-22 psi, hot 22-29 psi
- very heavy car (over 1400 kg): cold 27-35 psi, hot 37-40 psi
- maximum hot pressure 40 psi

Hoosier Racing Tire, R7 and A7 care and safety guidelines (https://www.hoosiertire.com/images/content/files/TCTR7_A7(1).pdf):

- minimum cold pressure 26 psi on all DOT radials
- over 3000 lb: cold 30-34 psi, hot 40-42+ psi
- never drop hot pressures back down to the cold set points; the tire is then severely under-inflated and can separate

Michelin UK, Pilot Sport Cup 2 R technical bulletin (https://marketing.michelin.co.uk/p/PDF/Technical%20Bulletin_PSC2R.pdf):

- hot 2.3-2.7 bar (33-40 psi), with 2.5 bar (36 psi) giving optimum performance
- never below 2.0 bar (29 psi)

Tire Review, Determining the right PSI (https://www.tirereview.com/determining-the-right-psi/):

- P-metric standard load sidewall maximum 44 psi or 51 psi; the maximum load itself is rated at 35 or 36 psi, and the sidewall figure is a capacity limit, not an operating pressure

## What a value outside the envelope means

- Below the envelope the carcass cannot hold its shape under load. The tread folds, the tire overheats, and on a tubeless rim the bead can unseat in a corner. No maker publishes a track or road pressure this low.
- Above the envelope the tire is past the maximum its sidewall is branded with. Grip falls as the contact patch shrinks, the ride goes harsh, and the casing is carrying a load it was never rated for.
- Neither is a tuning direction. The 0.5 psi reasoning in `pressure-basics.md` applies inside a tire's published window; a request premised on a value outside the whole envelope is answered by naming the envelope and the maker's table, not by refining the number.

## Using the envelope

Check a proposed absolute pressure against the maker's table for the actual tire first, and against this envelope only as a last line. Convert before comparing: 1 bar is 14.5 psi and 100 kPa is 14.5 psi. Keep hot and cold apart; a published minimum is a cold figure and a published maximum is the sidewall cold figure, so compare like with like.
