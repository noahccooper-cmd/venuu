import { prefetchVenues } from './venuesLoader';

// Imported first from main.tsx: ES modules evaluate in import order, so
// this fires the venues + estimates query before App, Mapbox GL and the
// rest of the bundle evaluate and before React mounts — it runs in
// parallel with all of that, plus auth and the map style load.
prefetchVenues();
