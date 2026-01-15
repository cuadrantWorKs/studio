import { useState, useEffect } from 'react';
import { db } from '@/lib/supabase';
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

    // Device ID from Environment or default to 'ricardo-iphone'
    const TRACCAR_DEVICE_ID = process.env.NEXT_PUBLIC_TRACCAR_DEVICE_ID || 'ricardo-iphone';
    const POLLING_INTERVAL_MS = 10000; // Poll every 10 seconds

    useEffect(() => {
        let isMounted = true;
        const fetchLocation = async () => {
            try {
                const { data, error } = await db
                    .from('raw_locations')
                    .select('*')
                    .eq('device_id', TRACCAR_DEVICE_ID)
                    .order('timestamp', { ascending: false })
                    .limit(1);

                if (error) throw error;

                if (data && data.length > 0) {
                    const latestLoc = data[0];
                    const newLocation: LocationPoint = {
                        latitude: latestLoc.latitude,
                        longitude: latestLoc.longitude,
                        accuracy: latestLoc.accuracy ?? undefined,
                        timestamp: new Date(latestLoc.timestamp).getTime(),
                    };

                    if (isMounted) {
                        setCurrentLocation(sanitizeLocationPoint(newLocation));
                        setGeolocationError(null);

                        // Check for staleness
                        const timeDiff = Date.now() - newLocation.timestamp;
                        if (timeDiff > 5 * 60 * 1000) { // 5 minutes
                            setGeolocationError({ code: 999, message: "GPS Offline: Sin datos recientes de Traccar (>5min)" });
                        }
                    }
                } else {
                    if (isMounted) {
                        setGeolocationError({ code: 404, message: "Esperando datos de Traccar..." });
                    }
                }
            } catch (err) {
                console.error("Error polling Traccar location:", err);
                if (isMounted) {
                    setGeolocationError({ code: 500, message: "Error conectando con servidor GPS" });
                }
            }
        };

        // Initial fetch
        fetchLocation();

        // Poll
        const intervalId = setInterval(fetchLocation, POLLING_INTERVAL_MS);

        return () => {
            isMounted = false;
            clearInterval(intervalId);
        };
    }, [toast]);

    return { currentLocation, geolocationError, sanitizeLocationPoint };
}
