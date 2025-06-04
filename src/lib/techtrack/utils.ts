// src/lib/techtrack/utils.ts
import { PauseInterval, LocationPoint } from "./types";

export function deserializePauseInterval(jsonString: string): PauseInterval[] {
  try {
    const parsed = JSON.parse(jsonString);
    if (Array.isArray(parsed)) {
      // Basic type assertion; more robust validation could be added
      return parsed as PauseInterval[];
    } else {
      console.error("Deserialized data is not an array:", parsed);
      return [];
    }
  } catch (error) {
    console.error("Error deserializing pause intervals:", error);
    return [];
  }
}

export function sanitizeLocationPoint(
  location: LocationPoint | null | undefined,
): LocationPoint | null {
  if (location === undefined || location === null) {
    return null;
  }
  // Basic check to ensure it has required properties, adjust as needed
  if (
    typeof location.latitude === "number" &&
    typeof location.longitude === "number" &&
    typeof location.timestamp === "number"
  ) {
    return location;
  }
  console.warn("Sanitizing invalid LocationPoint:", location);
  return null;
}
