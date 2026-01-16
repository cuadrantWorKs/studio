import { useState, useEffect } from 'react';
import { db } from '@/lib/supabase';
import { LocationPoint, RawLocationData, GeolocationError } from '@/lib/techtrack/types';
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
    const [rawLocationData, setRawLocationData] = useState<RawLocationData | null>(null);
    const [geolocationError, setGeolocationError] = useState<GeolocationError | null>(null);
    const { toast } = useToast();

    // Device ID from Environment or default to 'ricardo-iphone'
    const TRACCAR_DEVICE_ID = process.env.NEXT_PUBLIC_TRACCAR_DEVICE_ID || 'ricardo-iphone';
    const POLLING_INTERVAL_MS = 10000; // Poll every 10 seconds

    useEffect(() => {
        let isMounted = true;

        // const getBrowserLocation = () => {
        //     if (!navigator.geolocation) {
        //         if (isMounted) setGeolocationError({ code: 0, message: "Geolocalización no soportada" });
        //         return;
        //     }

        //     navigator.geolocation.getCurrentPosition(
        //         (position) => {
        //             if (!isMounted) return;
        //             const browserLoc: LocationPoint = {
        //                 latitude: position.coords.latitude,
        //                 longitude: position.coords.longitude,
        //                 accuracy: position.coords.accuracy,
        //                 timestamp: position.timestamp
        //             };
        //             setCurrentLocation(sanitizeLocationPoint(browserLoc));
        //             setGeolocationError(null);
        //             console.log("[GPS] Usando ubicación del navegador (Fallback)");
        //         },
        //         (error) => {
        //             if (!isMounted) return;
        //             console.warn("[GPS] Falló la ubicación del navegador:", error);
        //         },
        //         { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 }
        //     );
        // };

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
                    const loc = data[0];
                    // Parse timestamp (now stored as timestamptz string)
                    let timestamp = new Date(loc.timestamp).getTime();

                    // Sanity check: if year < 2025, use created_at
                    if (new Date(timestamp).getFullYear() < 2025) {
                        console.warn("[GPS] Timestamp inválido, usando created_at");
                        timestamp = new Date(loc.created_at).getTime();
                    }

                    // Build extended location data
                    const extendedData: RawLocationData = {
                        deviceId: loc.device_id,
                        latitude: loc.latitude,
                        longitude: loc.longitude,
                        timestamp: timestamp,
                        accuracy: loc.accuracy ?? undefined,
                        altitude: loc.altitude ?? undefined,
                        speed: loc.speed ?? undefined,
                        bearing: loc.bearing ?? undefined,
                        battery: loc.battery ?? undefined,
                        batteryIsCharging: loc.battery_is_charging ?? undefined,
                        event: loc.event ?? undefined,
                        isMoving: loc.is_moving ?? undefined,
                        odometer: loc.odometer ?? undefined,
                        activityType: loc.activity_type ?? undefined,
                    };

                    const basicLocation: LocationPoint = {
                        latitude: loc.latitude,
                        longitude: loc.longitude,
                        timestamp: timestamp,
                        accuracy: loc.accuracy ?? undefined,
                    };

                    if (isMounted) {
                        const timeDiff = Date.now() - timestamp;
                        const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

                        console.log(`[GPS] ${loc.event || 'update'} | ${new Date(timestamp).toLocaleTimeString()} | ${extendedData.isMoving ? '🚗' : '🅿️'} | 🔋${((extendedData.battery ?? 0) * 100).toFixed(0)}%`);

                        if (timeDiff > STALE_THRESHOLD_MS) {
                            setGeolocationError({ code: 999, message: `GPS Offline: ${(timeDiff / 60000).toFixed(0)} min` });
                            // getBrowserLocation(); // DISABLED PER USER REQUEST
                        } else {
                            setCurrentLocation(sanitizeLocationPoint(basicLocation));
                            setRawLocationData(extendedData);
                            setGeolocationError(null);
                        }
                    }
                } else {
                    if (isMounted) {
                        setGeolocationError({ code: 404, message: "Esperando datos GPS..." });
                        // getBrowserLocation(); // DISABLED PER USER REQUEST
                    }
                }
            } catch (err) {
                console.error("Error polling GPS:", err);
                if (isMounted) {
                    setGeolocationError({ code: 500, message: "Error de conexión GPS" });
                    // getBrowserLocation(); // DISABLED PER USER REQUEST
                }
            }
        };

        fetchLocation();
        const intervalId = setInterval(fetchLocation, POLLING_INTERVAL_MS);

        return () => {
            isMounted = false;
            clearInterval(intervalId);
        };
    }, [toast, TRACCAR_DEVICE_ID]);

    return { currentLocation, rawLocationData, geolocationError, sanitizeLocationPoint };
}
