// A small synthetic sector for tests (real baked sectors are gitignored and absent on a clean
// clone). A jittered corridor of stars with a mix of classes, Kepler hosts, and KOIs.

import { createRng } from '../../src/rng.ts';
import type { Sector, SectorPlanet, SectorStar } from '../../src/sector.ts';

export function makeSector(seed = 'fixture', count = 260, lengthLy = 180): Sector {
  const rng = createRng(seed);
  const stars: SectorStar[] = [];
  const teffs = [3200, 3500, 3900, 4400, 5200, 5800, 6400, 7800, 11000];
  for (let i = 0; i < count; i++) {
    const x = -lengthLy / 2 + (lengthLy * i) / (count - 1) + rng.range(-2, 2);
    const kepler = rng.chance(0.25);
    stars.push({
      id: kepler ? `KIC ${100000 + i}` : `Gaia DR3 ${900000 + i}`,
      kepid: kepler ? 100000 + i : null,
      gaiaId: String(900000 + i),
      name: null,
      pos: [x, rng.range(-18, 18), rng.range(-18, 18)],
      teff: rng.chance(0.9) ? rng.pick(teffs) : null,
      radius: rng.chance(0.7) ? rng.range(0.3, 1.8) : null,
      mh: rng.chance(0.8) ? rng.range(-0.5, 0.4) : null,
      gmag: rng.range(8, 18),
      bpRp: rng.range(0.2, 3),
      distLy: 800 + x,
      flags: { keplerTarget: kepler, host: false, koi: false, landmark: false },
    });
  }
  stars.sort((a, b) => a.pos[0] - b.pos[0]);
  const planets: SectorPlanet[] = [];
  const keplerIdx = stars.map((s, i) => (s.flags.keplerTarget ? i : -1)).filter((i) => i >= 0);
  keplerIdx.slice(0, 30).forEach((si, k) => {
    const star = stars[si] as SectorStar;
    const confirmed = k % 3 === 0;
    star.flags.koi = true;
    if (confirmed) {
      star.flags.host = true;
      star.name = `Kepler-${9000 + k}`;
    }
    planets.push({
      starIndex: si,
      koi: `K${String(8000 + k).padStart(5, '0')}.01`,
      name: confirmed ? `Kepler-${9000 + k} b` : null,
      disposition: confirmed ? 'CONFIRMED' : 'CANDIDATE',
      periodDays: rng.range(1, 400),
      radiusEarth: rng.chance(0.9) ? rng.range(0.6, 14) : null,
      smaAu: rng.chance(0.8) ? rng.range(0.02, 1.2) : null,
      teqK: rng.chance(0.8) ? rng.range(180, 1500) : null,
      koiScore: rng.chance(0.8) ? rng.next() : null,
      fpFlags: {
        notTransitLike: k % 5 === 1 ? 1 : 0,
        stellarEclipse: k % 7 === 2 ? 1 : 0,
        centroidOffset: 0,
        ephemerisMatch: null,
      },
    });
  });
  const landmark = stars[count - 2] as SectorStar;
  landmark.flags.landmark = true;
  landmark.name = 'Fixture Landmark';
  const neighbors: [number, number][][] = stars.map((a, i) =>
    stars
      .map((b, j): [number, number] => [
        j,
        Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]),
      ])
      .filter(([j, d]) => j !== i && d <= 30)
      .map(([j, d]): [number, number] => [j, Math.round(d * 100) / 100])
      .sort((p, q) => p[1] - q[1] || p[0] - q[0]),
  );
  return {
    id: 'fixture',
    version: 1,
    meta: {
      lengthLy,
      radiusLy: 25,
      starCount: count,
      hostCount: 10,
      koiCount: planets.length,
      landmarks: ['Fixture Landmark'],
    },
    start: { starIndex: 0 },
    goal: { starIndex: count - 2 },
    sunDirection: [0, 0, 1],
    sunDistanceLy: 800,
    stars,
    planets,
    neighbors,
  };
}
