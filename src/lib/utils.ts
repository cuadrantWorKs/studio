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
