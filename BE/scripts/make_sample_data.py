from __future__ import annotations

import csv
import random
from datetime import date, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "sample_data"
OUT.mkdir(exist_ok=True)
rng = random.Random(7)

PLATFORMS = {
    "ISS": (28.57, -80.65, "USA", 1_000_000),
    "Drop Tower": (41.41, -81.86, "USA", 5),
    "Parabolic Flight": (29.55, -95.09, "USA", 22),
    "Sounding Rocket": (37.94, -75.46, "USA", 360),
    "Bremen Drop Tower": (53.10, 8.85, "Germany", 4),
}
FUELS = {"PMMA": 1.0, "Heptane": 1.6, "Methane": 1.3, "Ethanol": 1.1, "Cotton fabric": 0.7}
GRAVITY = {"microgravity": 0.0, "lunar (0.16 g)": 0.16, "mars (0.38 g)": 0.38, "earth (1 g)": 1.0}

rows = []
for i in range(1, 181):
    platform = rng.choice(list(PLATFORMS))
    fuel = rng.choice(list(FUELS))
    g_name = "microgravity" if platform != "Parabolic Flight" else rng.choice(list(GRAVITY))
    g = GRAVITY[g_name]
    o2 = round(rng.uniform(15, 30), 1)
    pressure = rng.choice([50, 70, 101.3, 101.3, 101.3])
    speed = max(0.2, (o2 - 14) * 0.9 * FUELS[fuel] * (0.55 + 0.45 * g) * (pressure / 101.3) ** 0.4 + rng.gauss(0, 0.6))
    temp = 900 + (o2 - 15) * 38 * FUELS[fuel] + rng.gauss(0, 40) - (1 - g) * 90
    extinguished = (o2 < 18.5 and g < 0.5 and rng.random() < 0.8) or rng.random() < 0.05
    d = date(2019, 1, 1) + timedelta(days=rng.randint(0, 6 * 365))
    rows.append(
        {
            "experiment_id": f"EXP-{i:04d}",
            "date": d.isoformat(),
            "platform": platform,
            "fuel": fuel,
            "gravity_condition": g_name,
            "gravity_g": g,
            "oxygen_pct": o2,
            "pressure_kpa": pressure,
            "flame_speed_mm_s": round(speed, 2),
            "peak_temp_k": round(temp, 0),
            "soot_yield_pct": round(max(0.0, rng.gauss(1.4 * FUELS[fuel], 0.5)), 2),
            "extinguished": "yes" if extinguished else "no",
        }
    )

with open(OUT / "synthetic_combustion_experiments.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0]))
    w.writeheader()
    w.writerows(rows)

with open(OUT / "synthetic_facilities.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["platform", "country", "latitude", "longitude", "max_duration_s"])
    for name, (lat, lon, country, dur) in PLATFORMS.items():
        w.writerow([name, country, lat, lon, dur])

(OUT / "synthetic_fire_safety_note.txt").write_text(
    """SYNTHETIC DEMO DOCUMENT - not an actual NASA publication.

Spacecraft Fire Safety: Summary of Microgravity Flame Behaviour

Abstract. In microgravity there is no buoyant convection, so flames are spherical or
dome-shaped and sustained only by diffusion of oxygen. This changes ignition,
spread and extinction relative to flames on Earth. Low oxygen concentrations that
would extinguish a flame quickly on Earth can allow a slow, smouldering flame to
persist in microgravity for longer than expected.

Key finding 1. Flame spread rate over thin solid fuels depends strongly on the
oxygen concentration and on the ambient flow velocity. In quiescent microgravity
flames can spread more slowly than at 1 g, yet they extinguish at lower oxygen
levels, which narrows the margin used to define material flammability limits.

Key finding 2. Soot production is generally higher for gaseous and liquid fuels in
microgravity because residence times in the flame zone are longer. Higher soot
loading increases radiative heat loss and the toxic hazard to the crew.

Implications for Moon and Mars missions. Lunar (0.16 g) and Martian (0.38 g)
gravity create partial buoyancy, so test data at partial gravity is needed to
interpolate between 0 g and 1 g. Crew safety standards should use oxygen
concentration limits validated at the gravity level of the destination.
""",
    encoding="utf-8",
)
print("wrote", [p.name for p in OUT.iterdir()])
