'use client';

import type { LocationPoint } from '@/lib/techtrack/types';
import { MapPin } from 'lucide-react';

import LocationDisplay from './LocationDisplay';

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

  return (
    <LocationDisplay
      location={loc}
      label={label}
      time={time}
    />
  );
}
