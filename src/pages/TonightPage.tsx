import { useState, useCallback, useRef } from 'react';
import { MapView } from '../components/Map/MapView';
import { VenueSheet } from '../components/Map/VenueCard';
import { TheDrop } from '../components/Map/TheDrop';
import type { Venue, Headcount } from '../lib/types';
import type { CityKey } from '../lib/constants';

interface TonightPageProps {
  city: CityKey;
  venues: Venue[];
  counts: Record<string, number>;
  headcounts: Record<string, Headcount>;
  liveVenueIds: Set<string>;
  pulsedVenueId: string | null;
  username: string;
}

export function TonightPage({
  city,
  venues,
  counts,
  headcounts,
  liveVenueIds,
  pulsedVenueId,
  username,
}: TonightPageProps) {
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const mapInstanceRef = useRef<any>(null);

  // Keep selectedVenue in sync with venues array (for realtime special updates)
  const currentVenue = selectedVenue
    ? venues.find(v => v.id === selectedVenue.id) ?? selectedVenue
    : null;

  const handleVenueClick = useCallback((venue: Venue) => {
    setSelectedVenue(venue);
    if (mapInstanceRef.current) {
      const map = mapInstanceRef.current;
      // Offset upward so venue dot isn't hidden by bottom sheet
      const bounds = map.getBounds();
      if (!bounds) return;
      const latSpan = bounds.getNorth() - bounds.getSouth();
      const offsetLat = venue.lat - latSpan * 0.12;
      map.flyTo({
        center: [venue.lng, offsetLat],
        zoom: Math.max(map.getZoom(), 14.5),
        duration: 400,
        essential: true,
      });
    }
  }, []);

  const handleClose = useCallback(() => {
    setSelectedVenue(null);
  }, []);

  const handleMapTap = useCallback(() => {
    if (selectedVenue) {
      setSelectedVenue(null);
    }
  }, [selectedVenue]);

  const handleFlyTo = useCallback((lng: number, lat: number) => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo({
        center: [lng, lat],
        zoom: Math.max(mapInstanceRef.current.getZoom(), 15),
        duration: 600,
        essential: true,
      });
    }
  }, []);

  return (
    <div className="absolute inset-0" style={{ top: 'calc(80px + env(safe-area-inset-top, 0px))', bottom: '60px' }}>
      <TheDrop venues={venues} onFlyTo={handleFlyTo} />
      <MapView
        city={city}
        venues={venues}
        counts={counts}
        liveVenueIds={liveVenueIds}
        pulsedVenueId={pulsedVenueId}
        onVenueClick={handleVenueClick}
        onMapTap={handleMapTap}
        mapInstanceRef={mapInstanceRef}
      />

      {currentVenue && (
        <VenueSheet
          venue={currentVenue}
          headcount={headcounts[currentVenue.id] ?? null}
          username={username}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
