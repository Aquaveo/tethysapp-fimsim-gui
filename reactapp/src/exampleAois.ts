// reactapp/src/exampleAois.ts
// The Neuse River test AOI shipped with desktop FIMsim (test_case/AOI_1_Neuse,
// Hurricane Matthew walkthrough), reprojected from EPSG:26917 to WGS84.
import type { AoiFeature } from './geo';

export const NEUSE_AOI: AoiFeature = {
  type: 'Feature',
  properties: { name: 'Neuse River, NC (example)' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-78.10992, 35.45282],
        [-77.93055, 35.44839],
        [-77.93668, 35.28632],
        [-78.1157, 35.29072],
        [-78.10992, 35.45282],
      ],
    ],
  },
};
