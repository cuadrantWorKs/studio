'use client';

import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Workday, Job, PauseInterval, LocationPoint } from '@/lib/techtrack/types';
import { useEffect, useMemo } from 'react';

// Custom marker icon creators
const createStartIcon = () => {
    return L.divIcon({
        className: 'custom-marker',
        html: `
            <div style="
                background-color: #22c55e;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                border: 3px solid white;
                box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                font-size: 14px;
            ">S</div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16],
    });
};

const createEndIcon = () => {
    return L.divIcon({
        className: 'custom-marker',
        html: `
            <div style="
                background-color: #ef4444;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                border: 3px solid white;
                box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                font-size: 14px;
            ">E</div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16],
    });
};

const createJobIcon = (number: number) => {
    return L.divIcon({
        className: 'custom-marker',
        html: `
            <div style="
                background-color: #3b82f6;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                border: 3px solid white;
                box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                font-size: 14px;
            ">${number}</div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16],
    });
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

import LocationDisplay from './LocationDisplay';

export default function WorkdayMap({ workday }: WorkdayMapProps) {
    // Sort jobs by startTime to get proper order
    const sortedJobs = useMemo(() => {
        return [...workday.jobs].sort((a, b) => a.startTime - b.startTime);
    }, [workday.jobs]);

    // Create markers
    // Start
    const startPos = workday.startLocation ? [workday.startLocation.latitude, workday.startLocation.longitude] as [number, number] : null;
    // End
    const endPos = workday.endLocation ? [workday.endLocation.latitude, workday.endLocation.longitude] as [number, number] : null;

    // Job markers with order numbers
    const jobMarkers = useMemo(() => {
        return sortedJobs.map((j, index) => ({
            pos: [j.startLocation.latitude, j.startLocation.longitude] as [number, number],
            title: `Job ${index + 1}: ${j.description}`,
            summary: j.aiSummary || j.summary || 'Sin resumen',
            id: j.id,
            orderNumber: index + 1,
            time: new Date(j.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            rawLocation: j.startLocation
        }));
    }, [sortedJobs]);

    // Build logical polyline path: Start → Jobs (in order) → End
    const pathCoordinates = useMemo(() => {
        const coords: [number, number][] = [];

        // Add start position
        if (startPos) {
            coords.push(startPos);
        }

        // Add job positions in order
        jobMarkers.forEach(job => {
            coords.push(job.pos);
        });

        // Add end position
        if (endPos) {
            coords.push(endPos);
        }

        return coords;
    }, [startPos, endPos, jobMarkers]);

    // Calculate Bounds based on all markers
    const bounds = useMemo(() => {
        const allPoints = [...pathCoordinates];
        if (allPoints.length === 0) return undefined;

        const lats = allPoints.map(p => p[0]);
        const lngs = allPoints.map(p => p[1]);
        return [
            [Math.min(...lats), Math.min(...lngs)],
            [Math.max(...lats), Math.max(...lngs)]
        ] as L.LatLngBoundsExpression;
    }, [pathCoordinates]);

    const center = startPos || [-34.6037, -58.3816]; // Default Buenos Aires

    // Memoize icons to prevent re-creation on each render
    const startIcon = useMemo(() => createStartIcon(), []);
    const endIcon = useMemo(() => createEndIcon(), []);

    return (
        <div className="h-[60vh] md:h-[500px] w-full border rounded-lg overflow-hidden relative z-0">
            <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {/* Route Line - connects Start → Jobs → End in logical order */}
                {pathCoordinates.length >= 2 && (
                    <Polyline
                        positions={pathCoordinates}
                        color="#3b82f6"
                        weight={4}
                        opacity={0.7}
                        dashArray="10, 10"
                    />
                )}

                {/* Start Marker - Green */}
                {startPos && (
                    <Marker position={startPos} icon={startIcon}>
                        <Popup>
                            <div className="min-w-[150px]">
                                <strong>🟢 Inicio de Jornada</strong><br />
                                {workday.startTime && (
                                    <div className="mt-1">
                                        <LocationDisplay location={workday.startLocation!} showCoordinates={false} time={workday.startTime} />
                                    </div>
                                )}
                            </div>
                        </Popup>
                    </Marker>
                )}

                {/* Job Markers - Blue with numbers */}
                {jobMarkers.map(j => (
                    <Marker key={j.id} position={j.pos} icon={createJobIcon(j.orderNumber)}>
                        <Popup>
                            <div className="min-w-[200px]">
                                <strong>🔵 {j.title}</strong><br />
                                <div className="mt-1 mb-2">
                                    <LocationDisplay location={j.rawLocation} showCoordinates={false} />
                                </div>
                                <p className="text-xs text-slate-600 border-t pt-2 mt-2">{j.summary}</p>
                            </div>
                        </Popup>
                    </Marker>
                ))}

                {/* End Marker - Red */}
                {endPos && (
                    <Marker position={endPos} icon={endIcon}>
                        <Popup>
                            <div className="min-w-[150px]">
                                <strong>🔴 Fin de Jornada</strong><br />
                                {workday.endTime && (
                                    <div className="mt-1">
                                        <LocationDisplay location={workday.endLocation!} showCoordinates={false} time={workday.endTime} />
                                    </div>
                                )}
                            </div>
                        </Popup>
                    </Marker>
                )}

                {bounds && <MapBounds bounds={bounds} />}
            </MapContainer>
        </div>
    );
}

