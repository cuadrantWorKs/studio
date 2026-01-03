'use client';

import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Workday, Job, PauseInterval, LocationPoint } from '@/lib/techtrack/types';
import { useEffect } from 'react';

// Fix Leaflet's default icon paths which are often broken in webpack/next
const iconRetinaUrl = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png';
const iconUrl = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png';
const shadowUrl = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;

L.Icon.Default.mergeOptions({
    iconRetinaUrl,
    iconUrl,
    shadowUrl,
});

// Custom Icons
const createIcon = (color: string) => {
    // Using a simple HTML/DivIcon might be better or filtered images, 
    // but for simplicity we'll stick to default blue markers or search for colored ones later.
    // For now, standard markers.
    return new L.Icon.Default();
};

interface WorkdayMapProps {
    workday: Workday;
}

function MapBounds({ bounds }: { bounds: L.LatLngBoundsExpression }) {
    const map = useMap();
    useEffect(() => {
        if (bounds) {
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }, [bounds, map]);
    return null;
}

export default function WorkdayMap({ workday }: WorkdayMapProps) {
    const pathCoordinates = workday.locationHistory.map(l => [l.latitude, l.longitude] as [number, number]);

    // Create markers
    // Start
    const startPos = workday.startLocation ? [workday.startLocation.latitude, workday.startLocation.longitude] as [number, number] : null;
    // End
    const endPos = workday.endLocation ? [workday.endLocation.latitude, workday.endLocation.longitude] as [number, number] : null;

    // Jobs
    const jobMarkers = workday.jobs.map(j => ({
        pos: [j.startLocation.latitude, j.startLocation.longitude] as [number, number],
        title: `Job: ${j.description}`,
        summary: j.aiSummary || j.summary || 'No summary',
        id: j.id
    }));

    // Calculate Bounds
    let bounds: L.LatLngBoundsExpression | undefined;
    if (pathCoordinates.length > 0) {
        const lats = pathCoordinates.map(p => p[0]);
        const lngs = pathCoordinates.map(p => p[1]);
        bounds = [
            [Math.min(...lats), Math.min(...lngs)],
            [Math.max(...lats), Math.max(...lngs)]
        ];
    } else if (startPos) {
        bounds = [startPos, startPos];
    }

    const center = startPos || [-34.6037, -58.3816]; // Default Buenos Aires

    return (
        <div className="h-[60vh] md:h-[500px] w-full border rounded-lg overflow-hidden relative z-0">
            <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {/* Route Line */}
                <Polyline positions={pathCoordinates} color="blue" weight={4} opacity={0.6} />

                {/* Start Marker */}
                {startPos && (
                    <Marker position={startPos}>
                        <Popup>
                            <strong>Start of Day</strong><br />
                            {workday.startTime ? new Date(workday.startTime).toLocaleTimeString() : ''}
                        </Popup>
                    </Marker>
                )}

                {/* End Marker */}
                {endPos && (
                    <Marker position={endPos}>
                        <Popup>
                            <strong>End of Day</strong><br />
                            {workday.endTime ? new Date(workday.endTime).toLocaleTimeString() : ''}
                        </Popup>
                    </Marker>
                )}

                {/* Job Markers */}
                {jobMarkers.map(j => (
                    <Marker key={j.id} position={j.pos}>
                        <Popup>
                            <strong>{j.title}</strong><br />
                            {j.summary}
                        </Popup>
                    </Marker>
                ))}

                {bounds && <MapBounds bounds={bounds} />}
            </MapContainer>
        </div>
    );
}
