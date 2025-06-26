import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(seconds).padStart(2, "0")}`;
}

  // Function to format distance for display
export const formatDistance = (distanceInMeters: any): string => {
  if(distanceInMeters){
    if (distanceInMeters < 1000) {
      return `${distanceInMeters.toFixed(0)} m`;
    } else {
      return `${(distanceInMeters / 1000).toFixed(2)} km`;
    }
  }
  return 'n/a';
  };

// Convert snake_case to camelCase
export function toCamelCase(obj: object | null): any {
  if (obj === null || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(toCamelCase);
  }

  const camelCaseObj = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (match, letter) =>
      letter.toUpperCase()
    );
    camelCaseObj[camelKey] =
      typeof value === "object" ? toCamelCase(value) : value;
  }
  return camelCaseObj;
}

// Convert camelCase to snake_case
export function toSnakeCase(obj: object | null): any {
  if (obj === null || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(toSnakeCase);
  }

  const snakeCaseObj = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(
      /[A-Z]/g,
      (letter) => `_${letter.toLowerCase()}`
    );
    snakeCaseObj[snakeKey] =
      typeof value === "object" ? toSnakeCase(value) : value;
  }
  return snakeCaseObj;
}

// utils/geolocationSetup.js
export function setupGeolocation() {
  // Check if we should use mock (development + specific flag)
  const shouldMock = process.env.NODE_ENV === 'development' && 
                     process.env.NEXT_PUBLIC_MOCK_GEOLOCATION === 'true';

  if (shouldMock && typeof window !== 'undefined') {
    console.log('🚗 Geolocation mock enabled for development');
    
    // Simple mock that updates every few seconds
    let currentIndex = 0;
    const drivingRoute = [
{ lat: -34.5950, lng: -58.3950, speed: 8 }, // Villa Crespo - residential start
{ lat: -34.5980, lng: -58.3920, speed: 12 }, // Approaching Av. Córdoba
{ lat: -34.6010, lng: -58.3890, speed: 18 }, // Barrio Norte area
{ lat: -34.6040, lng: -58.3860, speed: 15 }, // Recoleta - slower near cemetery
{ lat: -34.6070, lng: -58.3830, speed: 10 }, // Heavy traffic on Av. Las Heras
{ lat: -34.6100, lng: -58.3800, speed: 5 }, // Stop near Recoleta Cemetery
{ lat: -34.6130, lng: -58.3770, speed: 0 }, // Traffic light - Plaza Francia
{ lat: -34.6140, lng: -58.3750, speed: 8 }, // Moving through Retiro
{ lat: -34.6120, lng: -58.3720, speed: 15 }, // Approaching Microcentro
{ lat: -34.6100, lng: -58.3690, speed: 20 }, // Av. 9 de Julio area
{ lat: -34.6080, lng: -58.3660, speed: 12 }, // Downtown traffic
{ lat: -34.6060, lng: -58.3630, speed: 8 }, // Puerto Madero approach
{ lat: -34.6040, lng: -58.3600, speed: 22 }, // Puerto Madero - wider streets
{ lat: -34.6020, lng: -58.3570, speed: 18 }, // Ecological Reserve area
{ lat: -34.6000, lng: -58.3600, speed: 16 }, // Turning back towards center
{ lat: -34.6030, lng: -58.3650, speed: 14 }, // San Nicolás neighborhood
{ lat: -34.6080, lng: -58.3720, speed: 10 }, // Monserrat area
{ lat: -34.6130, lng: -58.3780, speed: 12 }, // San Telmo approach
{ lat: -34.6180, lng: -58.3820, speed: 8 }, // San Telmo historic area
{ lat: -34.6220, lng: -58.3860, speed: 6 }, // Narrow cobblestone streets
{ lat: -34.6250, lng: -58.3900, speed: 15 }, // La Boca direction
{ lat: -34.6280, lng: -58.3650, speed: 12 }, // Barracas neighborhood
{ lat: -34.6250, lng: -58.3600, speed: 18 }, // Returning north
{ lat: -34.6200, lng: -58.3550, speed: 20 }, // Constitución area
{ lat: -34.6150, lng: -58.3500, speed: 16 }, // Balvanera neighborhood
{ lat: -34.6100, lng: -58.3450, speed: 14 }, // Once area
{ lat: -34.6050, lng: -58.3400, speed: 12 } // Final destination - Almagro
    ]; 

  /*   const drivingRoute = [
      { lat: -34.5875, lng: -58.4200, speed: 8 }, // Palermo start - local streets
{ lat: -34.5850, lng: -58.4150, speed: 12 }, // Approaching highway access
{ lat: -34.5820, lng: -58.4100, speed: 18 }, // Acceleration lane
{ lat: -34.5790, lng: -58.4050, speed: 25 }, // Merging onto Autopista del Oeste
{ lat: -34.5760, lng: -58.4000, speed: 35 }, // Building speed
{ lat: -34.5730, lng: -58.3950, speed: 45 }, // Highway acceleration
{ lat: -34.5700, lng: -58.3900, speed: 65 }, // Reaching cruising speed
{ lat: -34.5670, lng: -58.3850, speed: 70 }, // Steady highway driving
{ lat: -34.5640, lng: -58.3800, speed: 70 }, // Maintaining speed
{ lat: -34.5610, lng: -58.3750, speed: 72 }, // Slight speed increase
{ lat: -34.5580, lng: -58.3700, speed: 72 }, // Consistent cruising
{ lat: -34.5550, lng: -58.3650, speed: 71 }, // Minor speed variation
{ lat: -34.5520, lng: -58.3600, speed: 73 }, // Steady driving
{ lat: -34.5490, lng: -58.3550, speed: 72 }, // Maintaining pace
{ lat: -34.5460, lng: -58.3500, speed: 70 }, // Consistent speed
{ lat: -34.5430, lng: -58.3450, speed: 71 }, // Steady cruising
{ lat: -34.5400, lng: -58.3400, speed: 72 }, // Highway maintenance
{ lat: -34.5370, lng: -58.3350, speed: 73 }, // Open road
{ lat: -34.5340, lng: -58.3300, speed: 71 }, // Sustained driving
{ lat: -34.5310, lng: -58.3250, speed: 70 }, // Consistent pace
{ lat: -34.5280, lng: -58.3200, speed: 68 }, // Slight deceleration
{ lat: -34.5250, lng: -58.3150, speed: 45 }, // Preparing to exit
{ lat: -34.5220, lng: -58.3100, speed: 25 }, // Exit ramp
{ lat: -34.5190, lng: -58.3050, speed: 15 }, // Local streets - Pilar area
{ lat: -34.5160, lng: -58.3000, speed: 10 } // Final destination
    ]; */

    const mockGeolocation = {
      getCurrentPosition(success, error, options) {
        const pos = drivingRoute[currentIndex];
        success({
          coords: {
            latitude: pos.lat,
            longitude: pos.lng,
            accuracy: 5,
            speed: pos.speed / 3.6, // km/h to m/s
            heading: 45, // degrees
            altitude: null,
            altitudeAccuracy: null
          },
          timestamp: Date.now()
        });
      },

      watchPosition(success, error, options) {
        // Call immediately
        this.getCurrentPosition(success, error, options);
        
        // Update position every 3 seconds
        const interval = setInterval(() => {
          currentIndex = (currentIndex + 1) % drivingRoute.length;
          this.getCurrentPosition(success, error, options);
        }, 3000);

        return interval;
      },

      clearWatch(watchId) {
        clearInterval(watchId);
      }
    };

    // Override the geolocation
    Object.defineProperty(navigator, 'geolocation', {
      value: mockGeolocation,
      writable: true
    });
  }
}
