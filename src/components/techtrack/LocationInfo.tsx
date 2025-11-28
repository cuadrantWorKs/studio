'use client';

import type { LocationPoint } from '@/lib/techtrack/types';
import { MapPin } from 'lucide-react';

interface LocationInfoProps {
  location?: LocationPoint | null;
  currentLocation?: LocationPoint | null;
  label?: string;
  time?: number;
  getGoogleMapsLink?: (location: LocationPoint) => string;
}

export default function LocationInfo({ location, currentLocation, label, time, getGoogleMapsLink }: LocationInfoProps) {
  const loc = location || currentLocation;

  if (!loc) return null;

  const defaultGetGoogleMapsLink = (l: LocationPoint) => `https://www.google.com/maps/search/?api=1&query=${l.latitude},${l.longitude}`;
  const getLink = getGoogleMapsLink || defaultGetGoogleMapsLink;

  return (
    <div className="text-xs mt-1">
      {label && <span className="font-medium">{label}</span>}
      {time && ` ${new Date(time).toLocaleTimeString()}`}
      {label ? ': ' : ''}
      (Lat: {loc.latitude.toFixed(4)}, Lon: {loc.longitude.toFixed(4)})
      <a href={getLink(loc)} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline ml-1 inline-flex items-center">
        <MapPin className="h-3 w-3 mr-0.5" />Map
      </a>
    </div>
  );
}
