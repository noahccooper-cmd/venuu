import type { CityAggregate } from '../hooks/useCityAggregates';

/**
 * Builds a stateful share-sheet caption from the live globe rollup.
 * Picks a tone based on whether any city is Surging, how many are
 * Lively/Busy, and whether it's a Fri/Sat night-late hour.
 */
export function generateGlobeCaption(
  aggregates: CityAggregate[],
  totalPeopleOut: number,
): string {
  const surgingCities = aggregates.filter(a => a.dominantState === 'Surging');
  const livelyCities = aggregates.filter(
    a => a.dominantState === 'Lively' || a.dominantState === 'Busy'
  );

  const day = new Date().getDay();             // 0 Sun .. 6 Sat
  const isWeekend = day === 5 || day === 6;
  const hour = new Date().getHours();
  const isLate = hour >= 22 || hour < 3;

  const totalStr = totalPeopleOut.toLocaleString();

  // Multiple surging cities = peak moment
  if (surgingCities.length >= 2) {
    const names = surgingCities.map(c => c.cityName).join(' & ');
    return `venuu is LIT tonight · ${names} surging · ${totalStr} out`;
  }

  // Single surging city
  if (surgingCities.length === 1) {
    return `${surgingCities[0].cityName} is alive tonight · ${totalStr} out across ${aggregates.length} cities`;
  }

  // Multiple lively cities + weekend = good energy
  if (livelyCities.length >= 2 && isWeekend) {
    return `${isLate ? 'late night' : 'weekend'} vibes · ${totalStr} out across the network`;
  }

  // Generic baseline
  return `tonight on venuu · ${totalStr} out across ${aggregates.length} cities · know before you go`;
}
