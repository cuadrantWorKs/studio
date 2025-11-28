import type { LocationPoint } from './types';

export function haversineDistance(coords1: Pick<LocationPoint, 'latitude' | 'longitude'>, coords2: Pick<LocationPoint, 'latitude' | 'longitude'>): number {
  const R = 6371000; // Earth radius in meters
  const lat1Rad = coords1.latitude * Math.PI / 180;
  const lat2Rad = coords2.latitude * Math.PI / 180;
  const deltaLatRad = (coords2.latitude - coords1.latitude) * Math.PI / 180;
  const deltaLonRad = (coords2.longitude - coords1.longitude) * Math.PI / 180;

  const a = Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) *
    Math.sin(deltaLonRad / 2) * Math.sin(deltaLonRad / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

export function calculateTotalDistance(locationHistory: LocationPoint[]): number {
  let totalDistance = 0;
  for (let i = 1; i < locationHistory.length; i++) {
    totalDistance += haversineDistance(locationHistory[i - 1], locationHistory[i]);
  }
  return totalDistance / 1000; // Convert to kilometers
}

import type { Workday } from './types';

export async function fetchDrivingDistance(start: LocationPoint, end: LocationPoint): Promise<number | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=false`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) return null;
    return data.routes[0].distance; // Returns meters
  } catch (error) {
    console.error("OSRM Fetch Error:", error);
    return null;
  }
}

export function calculateRobustDistance(workday: Workday, currentLocation?: LocationPoint | null, tortuosityFactor: number = 1.0): number {
  if (!workday.startLocation) return 0;

  let totalDistanceMeters = 0;
  let lastPoint = workday.startLocation;

  // Iterate through jobs to calculate distance between key points
  if (workday.jobs) {
    workday.jobs.forEach(job => {
      // Distance from previous point to job start
      if (job.startLocation) {
        if (job.drivingDistanceKm !== undefined) {
          totalDistanceMeters += (job.drivingDistanceKm * 1000);
        } else {
          totalDistanceMeters += haversineDistance(lastPoint, job.startLocation) * tortuosityFactor;
        }
        lastPoint = job.startLocation;
      }

      // Distance from job start to job end (if moved during job, or just to update lastPoint)
      if (job.endLocation) {
        // For internal job movement, we default to Haversine * factor as we don't store OSRM for this part specifically yet
        totalDistanceMeters += haversineDistance(lastPoint, job.endLocation) * tortuosityFactor;
        lastPoint = job.endLocation;
      }
    });
  }

  // If workday is ended, add distance to end location
  if (workday.status === 'ended' && workday.endLocation) {
    if (workday.finalLegDistanceKm !== undefined) {
      totalDistanceMeters += (workday.finalLegDistanceKm * 1000);
    } else {
      totalDistanceMeters += haversineDistance(lastPoint, workday.endLocation) * tortuosityFactor;
    }
  }
  // If tracking/paused and we have a current location, add distance from last known point to now
  else if (currentLocation && workday.status !== 'ended') {
    totalDistanceMeters += haversineDistance(lastPoint, currentLocation) * tortuosityFactor;
  }

  return totalDistanceMeters / 1000; // Convert to kilometers
}
