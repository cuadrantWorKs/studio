import type { LocationPoint } from "./types";

export function haversineDistance(
  coords1: Pick<LocationPoint, "latitude" | "longitude">,
  coords2: Pick<LocationPoint, "latitude" | "longitude">,
): number {
  const R = 6371000; // Earth radius in meters
  const lat1Rad = (coords1.latitude * Math.PI) / 180;
  const lat2Rad = (coords2.latitude * Math.PI) / 180;
  const deltaLatRad = ((coords2.latitude - coords1.latitude) * Math.PI) / 180;
  const deltaLonRad = ((coords2.longitude - coords1.longitude) * Math.PI) / 180;

  const a =
    Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
    Math.cos(lat1Rad) *
      Math.cos(lat2Rad) *
      Math.sin(deltaLonRad / 2) *
      Math.sin(deltaLonRad / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

export function calculateTotalDistance(
  locationHistory: LocationPoint[],
): number {
  let totalDistance = 0;
  for (let i = 1; i < locationHistory.length; i++) {
    totalDistance += haversineDistance(
      locationHistory[i - 1],
      locationHistory[i],
    );
  }
  return totalDistance / 1000; // Convert to kilometers
}
