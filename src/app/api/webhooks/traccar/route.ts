import { NextRequest, NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase-admin';
import { Database } from '@/lib/techtrack/supabase-types';
import { haversineDistance } from '@/lib/techtrack/geometry';

// Type definition for raw_locations insert
type RawLocationInsert = Database['public']['Tables']['raw_locations']['Insert'];

export async function GET(request: NextRequest) {
    return handleRequest(request);
}

export async function POST(request: NextRequest) {
    return handleRequest(request);
}

/**
 * TransistorSoft Background Geolocation Webhook Handler
 * 
 * Expected payload format:
 * {
 *   "location": {
 *     "coords": { "latitude", "longitude", "accuracy", "altitude", "speed", "heading" },
 *     "timestamp": "ISO 8601 string",
 *     "is_moving": boolean,
 *     "event": "motionchange" | "heartbeat" | "geofence" | etc,
 *     "odometer": number,
 *     "activity": { "type": "unknown" | "walking" | "in_vehicle" | etc },
 *     "battery": { "level": 0-1, "is_charging": boolean }
 *   },
 *   "device_id": "string"
 * }
 */
async function handleRequest(request: NextRequest) {
    try {
        const url = new URL(request.url);
        console.log(`[Traccar] ${request.method} from ${request.headers.get('x-real-ip') || 'unknown'}`);

        // 1. PARSE REQUEST BODY
        let payload: any = {};

        if (request.method === 'POST') {
            const contentType = request.headers.get('content-type') || '';

            if (contentType.includes('application/json')) {
                payload = await request.json();
            } else if (contentType.includes('application/x-www-form-urlencoded')) {
                const formData = await request.formData();
                payload = Object.fromEntries(formData.entries());
            }
        }

        // Merge URL params (for GET requests or hybrid)
        const urlParams = Object.fromEntries(url.searchParams.entries());
        payload = { ...urlParams, ...payload };

        // 2. EXTRACT TransistorSoft LOCATION DATA
        const location = payload.location || {};
        const coords = location.coords || {};

        // Device ID: check multiple sources
        const deviceId = payload.device_id || payload.deviceId || payload.id || urlParams.id;

        // Handle Registration/Notification Token Requests (no location data)
        if (payload.notificationToken && deviceId) {
            console.log(`[Traccar] Device registered: ${deviceId}`);
            return new NextResponse('Registered', { status: 200 });
        }

        if (!deviceId) {
            console.error('[Traccar] Missing device_id');
            return new NextResponse('device_id required', { status: 400 });
        }

        // Coordinates: from coords object or flat params
        const lat = coords.latitude ?? parseFloat(payload.lat || payload.latitude);
        const lon = coords.longitude ?? parseFloat(payload.lon || payload.longitude);

        if (isNaN(lat) || isNaN(lon)) {
            console.error('[Traccar] Invalid coordinates:', { lat, lon, payload });
            return new NextResponse('Valid latitude and longitude required', { status: 400 });
        }

        // 3. PARSE TIMESTAMP (ISO 8601 string from TransistorSoft)
        let timestamp: string;
        const rawTimestamp = location.timestamp || payload.timestamp;

        if (!rawTimestamp) {
            timestamp = new Date().toISOString();
        } else if (typeof rawTimestamp === 'string' && rawTimestamp.includes('T')) {
            // Already ISO format
            timestamp = rawTimestamp;
        } else if (/^\d+$/.test(String(rawTimestamp))) {
            // Numeric epoch (seconds or ms)
            const ts = Number(rawTimestamp);
            timestamp = new Date(ts < 10000000000 ? ts * 1000 : ts).toISOString();
        } else {
            // Try parsing as date string
            const parsed = new Date(rawTimestamp);
            timestamp = isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
        }

        // Sanity check: reject dates before 2025
        if (new Date(timestamp).getFullYear() < 2025) {
            console.warn(`[Traccar] Old timestamp rejected: ${timestamp}`);
            timestamp = new Date().toISOString();
        }

        // 4. EXTRACT ALL METADATA
        const battery = location.battery || payload.battery || {};
        const activity = location.activity || {};

        const rawData: RawLocationInsert = {
            device_id: deviceId,
            latitude: lat,
            longitude: lon,
            timestamp: timestamp,
            accuracy: coords.accuracy ?? (payload.accuracy ? parseFloat(payload.accuracy) : null),
            altitude: coords.altitude ?? (payload.altitude ? parseFloat(payload.altitude) : null),
            speed: coords.speed ?? (payload.speed ? parseFloat(payload.speed) : null),
            bearing: coords.heading ?? (payload.heading ? parseFloat(payload.heading) : null),
            battery: typeof battery.level === 'number' ? battery.level : (payload.batt ? parseFloat(payload.batt) : null),
            battery_is_charging: battery.is_charging ?? false,
            event: location.event || payload.event || null,
            is_moving: location.is_moving ?? false,
            odometer: location.odometer ?? null,
            activity_type: activity.type || null,
            processed: false
        };

        console.log(`[Traccar] ${deviceId} @ ${timestamp} | ${rawData.event || 'update'} | moving:${rawData.is_moving}`);

        // 5. INSERT INTO DATABASE
        const adminDb = getAdminSupabase();
        const { error: insertError } = await adminDb.from('raw_locations').insert(rawData);

        if (insertError) {
            console.error('[Traccar] DB Error:', insertError.message);
            return new NextResponse(`Database Error: ${insertError.message}`, { status: 500 });
        }

        // 6. GEOFENCE LOGIC (only for UUID device IDs = TechTrack users)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(deviceId)) {
            await processGeofence(adminDb, deviceId, lat, lon, timestamp, rawData.accuracy);
        }

        return new NextResponse('OK', { status: 200 });

    } catch (error: any) {
        console.error('[Traccar] Handler Error:', error.message);
        return new NextResponse(error.message || 'Internal Server Error', { status: 500 });
    }
}

/**
 * Process geofence exit detection for TechTrack workdays
 */
async function processGeofence(
    db: ReturnType<typeof getAdminSupabase>,
    deviceId: string,
    lat: number,
    lon: number,
    timestamp: string,
    accuracy: number | null
) {
    try {
        const { data: workday } = await db
            .from('workdays')
            .select(`
                id, 
                status,
                current_job_id,
                jobs (
                    id,
                    status,
                    start_location_latitude,
                    start_location_longitude
                )
            `)
            .eq('user_id', deviceId)
            .in('status', ['tracking', 'idle'])
            .order('date', { ascending: false })
            .limit(1)
            .single();

        if (!workday?.current_job_id) return;

        const currentJob = Array.isArray(workday.jobs)
            ? workday.jobs.find(j => j.id === workday.current_job_id)
            : null;

        if (!currentJob?.start_location_latitude || !currentJob?.start_location_longitude) return;

        const jobLoc = {
            latitude: currentJob.start_location_latitude,
            longitude: currentJob.start_location_longitude
        };
        const dist = haversineDistance(jobLoc, { latitude: lat, longitude: lon });
        const GEOFENCE_RADIUS = 200; // meters

        if (dist > GEOFENCE_RADIUS) {
            // Check if we already logged this exit
            const { data: lastEvent } = await db
                .from('events')
                .select('type')
                .eq('workday_id', workday.id)
                .eq('job_id', currentJob.id)
                .order('timestamp', { ascending: false })
                .limit(1)
                .single();

            if (!lastEvent || (lastEvent.type !== 'GEOFENCE_EXIT' && lastEvent.type !== 'JOB_COMPLETED')) {
                const timestampMs = new Date(timestamp).getTime();
                await db.from('events').insert({
                    workday_id: workday.id,
                    type: 'GEOFENCE_EXIT',
                    timestamp: timestampMs,
                    job_id: currentJob.id,
                    details: `Detected exit from job site (${Math.round(dist)}m away)`,
                    location_latitude: lat,
                    location_longitude: lon,
                    location_timestamp: timestampMs,
                    location_accuracy: accuracy
                } as any);

                console.log(`[Traccar] GEOFENCE_EXIT recorded for job ${currentJob.id}`);
            }
        }
    } catch (error: any) {
        console.error('[Traccar] Geofence Error:', error.message);
    }
}
