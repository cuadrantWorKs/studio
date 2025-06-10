'use client';

import type { LocationPoint } from '@/lib/techtrack/types';
import { MapPin } from 'lucide-react';

interface LocationInfoProps {
  location: LocationPoint | null; // Change from ? to | null
  label: string;
  time: number | null; // Also update time to accept null
  getGoogleMapsLink: (location: LocationPoint) => string;
}

export default function LocationInfo({ location, label, time, getGoogleMapsLink }: LocationInfoProps) {
  if (!location) return null;
  return (
    <div className="text-xs mt-1">
      <span className="font-medium">{label}</span>
      {time !== null && time !== undefined && ` ${new Date(time).toLocaleTimeString()}`}
      : (Lat: {location.latitude.toFixed(4)}, Lon: {location.longitude.toFixed(4)})
      <a href={getGoogleMapsLink(location)} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline ml-1 inline-flex items-center">
        <MapPin className="h-3 w-3 mr-0.5" />Map
      </a>
    </div>
  );
}
