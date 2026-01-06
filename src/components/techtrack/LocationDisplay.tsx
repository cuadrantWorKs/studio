'use client';

import { useState, useEffect } from 'react';
import type { LocationPoint } from '@/lib/techtrack/types';
import { MapPin, ExternalLink } from 'lucide-react';

interface LocationDisplayProps {
    location: LocationPoint;
    showCoordinates?: boolean;
    label?: string;
    time?: number;
}

// Simple in-memory cache for reverse geocoding results
const geocodeCache = new Map<string, string>();

export default function LocationDisplay({ location, showCoordinates = true, label, time }: LocationDisplayProps) {
    const [placeName, setPlaceName] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const cacheKey = `${location.latitude.toFixed(5)},${location.longitude.toFixed(5)}`;
    const googleMapsLink = `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;

    useEffect(() => {
        // Check cache first
        const cached = geocodeCache.get(cacheKey);
        if (cached) {
            setPlaceName(cached);
            return;
        }

        // Reverse geocode using Nominatim (free, no API key needed)
        const fetchPlaceName = async () => {
            setLoading(true);
            try {
                const response = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${location.latitude}&lon=${location.longitude}&zoom=14&addressdetails=1`,
                    {
                        headers: {
                            'Accept-Language': 'es', // Spanish for Argentina
                        },
                    }
                );

                if (response.ok) {
                    const data = await response.json();
                    // Extract locality info - try different levels
                    const address = data.address || {};
                    const locality =
                        address.city ||
                        address.town ||
                        address.village ||
                        address.suburb ||
                        address.municipality ||
                        address.county ||
                        address.state ||
                        data.display_name?.split(',')[0] ||
                        'Ubicación desconocida';

                    geocodeCache.set(cacheKey, locality);
                    setPlaceName(locality);
                }
            } catch (error) {
                console.error('Reverse geocoding error:', error);
                setPlaceName(null);
            } finally {
                setLoading(false);
            }
        };

        // Debounce to avoid too many API calls
        const timeoutId = setTimeout(fetchPlaceName, 100);
        return () => clearTimeout(timeoutId);
    }, [cacheKey, location.latitude, location.longitude]);

    return (
        <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
            {label && <span className="font-medium text-slate-700">{label}</span>}
            {time && <span className="text-slate-400"> {new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
            {(label || time) && <span className="text-slate-300">|</span>}

            <MapPin className="h-3 w-3 flex-shrink-0 text-slate-400" />

            {/* Place name */}
            {loading ? (
                <span className="text-slate-400 italic">Buscando...</span>
            ) : placeName ? (
                <span className="font-medium text-slate-600">{placeName}</span>
            ) : null}

            {/* Coordinates with link */}
            <a
                href={googleMapsLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-blue-500 hover:text-blue-700 hover:underline"
                title="Abrir en Google Maps"
            >
                {showCoordinates && (
                    <span className="font-mono text-[10px]">
                        ({location.latitude.toFixed(5)}, {location.longitude.toFixed(5)})
                    </span>
                )}
                <ExternalLink className="h-3 w-3" />
            </a>
        </div>
    );
}
