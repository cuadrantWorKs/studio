import { useState, useEffect } from 'react';
import { LocationPoint, GeolocationError } from '@/lib/techtrack/types';
import { useToast } from '@/hooks/use-toast';

// Helper function to sanitize location point data
export const sanitizeLocationPoint = (location: LocationPoint | null | undefined): LocationPoint | null => {
    if (
        location &&
        typeof location.latitude === 'number' && !isNaN(location.latitude) &&
        typeof location.longitude === 'number' && !isNaN(location.longitude) &&
        typeof location.timestamp === 'number' && !isNaN(location.timestamp)
    ) {
        const sanitized: LocationPoint = {
            latitude: location.latitude,
            longitude: location.longitude,
            timestamp: location.timestamp,
        };
        if (typeof location.accuracy === 'number' && !isNaN(location.accuracy)) {
            sanitized.accuracy = location.accuracy;
        }
        return sanitized;
    }
    return null;
};

export function useGeolocation() {
    const [currentLocation, setCurrentLocation] = useState<LocationPoint | null>(null);
    const [geolocationError, setGeolocationError] = useState<GeolocationError | null>(null);
    const { toast } = useToast();

    useEffect(() => {
        if (typeof navigator !== 'undefined' && navigator.geolocation) {
            const watchId = navigator.geolocation.watchPosition(
                (position) => {
                    const newLocation: LocationPoint = {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy ?? undefined,
                        timestamp: position.timestamp,
                    };
                    setCurrentLocation(sanitizeLocationPoint(newLocation));
                    setGeolocationError(null);
                },
                (error) => {
                    setGeolocationError({ code: error.code, message: error.message });
                    toast({ title: "Error de Geolocalización", description: error.message, variant: "destructive" });
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
            return () => navigator.geolocation.clearWatch(watchId);
        }
    }, [toast]);

    return { currentLocation, geolocationError, sanitizeLocationPoint };
}
