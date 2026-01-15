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

async function handleRequest(request: NextRequest) {
    try {
        const url = new URL(request.url);
        console.log(`[Traccar Webhook] ${request.method} request received`, request.headers.get('content-type'));
        const searchParams = url.searchParams;

        // 1. EXTRACT DATA
        let params = Object.fromEntries(searchParams.entries());

        if (request.method === 'POST') {
            try {
                const contentType = request.headers.get('content-type');
                if (contentType?.includes('application/x-www-form-urlencoded')) {
                    const formData = await request.formData();
                    const formParams = Object.fromEntries(formData.entries()) as Record<string, string>;
                    params = { ...params, ...formParams };
                } else if (contentType?.includes('application/json')) {
                    const jsonBody = await request.json();

                    // --- PAYLOAD NORMALIZATION ---
                    // Handle "TransistorSoft" style payloads where data is wrapped in "location"
                    let data = jsonBody;
                    if (data.location) {
                        data = { ...data, ...data.location }; // Unwrap 'location'
                    }

                    // Handle "coords" nesting
                    if (data.coords) {
                        data.latitude = data.coords.latitude;
                        data.longitude = data.coords.longitude;
                        data.accuracy = data.coords.accuracy;
                        data.altitude = data.coords.altitude;
                        data.heading = data.coords.heading;
                        data.speed = data.coords.speed;
                    }

                    params = { ...params, ...data };
                }
            } catch (e) {
                // ignore body parsing error, stick to URL params
            }
        }

        // 2. VALIDATE DEVICE
        const deviceId = params.id || params.deviceid || params.deviceId || params.device_id;
        if (!deviceId) {
            console.error('[Traccar Error] Missing Device ID. Params:', JSON.stringify(params));
            return new NextResponse('Device ID required', { status: 400 });
        }

        // 3. VALIDATE COORDS
        const lat = parseFloat(params.lat || params.latitude);
        const lon = parseFloat(params.lon || params.longitude);
        if (isNaN(lat) || isNaN(lon)) {
            console.error('[Traccar Error] Invalid Lat/Lon. Params:', JSON.stringify(params));
            return new NextResponse('Valid Latitude and Longitude required', { status: 400 });
        }

        // 4. ROBUST TIMESTAMP PARSING
        let timestampVal = params.timestamp;
        let finalTimestamp: string;

        if (!timestampVal) {
            finalTimestamp = new Date().toISOString();
        } else {
            // Check if it's a pure number (Unix timestamp).
            // Regex check because parseFloat("2026-01-15") returns 2026.
            const isNumeric = /^\d+$/.test(String(timestampVal));

            if (isNumeric) {
                const tsNum = Number(timestampVal);
                if (tsNum < 10000000000) { // Seconds
                    finalTimestamp = new Date(tsNum * 1000).toISOString();
                } else { // Ms
                    finalTimestamp = new Date(tsNum).toISOString();
                }
            } else {
                // Treat as date string
                try {
                    const dateObj = new Date(timestampVal);
                    if (isNaN(dateObj.getTime())) {
                        finalTimestamp = new Date().toISOString();
                    } else {
                        finalTimestamp = dateObj.toISOString();
                    }
                } catch {
                    finalTimestamp = new Date().toISOString();
                }
            }

            // Sanity Check: If timestamp is too old (e.g. 1970 or < 2025), use current time
            const dateObj = new Date(finalTimestamp);
            const minDate = new Date('2025-01-01').getTime();
            if (isNaN(dateObj.getTime()) || dateObj.getTime() < minDate) {
                console.warn(`[Traccar Warning] Invalid/Old timestamp received (${timestampVal} -> ${finalTimestamp}). Defaulting to NOW.`);
                finalTimestamp = new Date().toISOString();
            }
        }

        console.log(`[Traccar Debug] Processing ${deviceId} at ${finalTimestamp}`);

        const adminDb = getAdminSupabase();

        // 5. STORE RAW LOCATION
        const rawData: RawLocationInsert = {
            device_id: deviceId,
            latitude: lat,
            longitude: lon,
            timestamp: finalTimestamp,
            speed: params.speed ? parseFloat(params.speed) : null,
            bearing: params.bearing ? parseFloat(params.bearing) : params.heading ? parseFloat(params.heading) : null,
            altitude: params.altitude ? parseFloat(params.altitude) : null,
            accuracy: params.accuracy ? parseFloat(params.accuracy) : null,
            battery: params.batt ? parseFloat(params.batt) : params.battery?.level ? parseFloat(params.battery.level) : null,
            processed: false
        };

        const { error: insertError } = await adminDb.from('raw_locations').insert(rawData);
        if (insertError) {
            console.error('Error inserting raw location:', insertError);
            return new NextResponse('Database Error', { status: 500 });
        }

        // 6. GEOFENCE / EVENT LOGIC
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(deviceId)) {
            // Find active workday
            const { data: workday } = await adminDb
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

            if (workday && workday.current_job_id) {
                // Find the current job object
                const currentJob = Array.isArray(workday.jobs)
                    ? workday.jobs.find(j => j.id === workday.current_job_id)
                    : null;

                if (currentJob && currentJob.start_location_latitude && currentJob.start_location_longitude) {
                    const jobLoc = {
                        latitude: currentJob.start_location_latitude,
                        longitude: currentJob.start_location_longitude
                    };
                    const currentLoc = { latitude: lat, longitude: lon };

                    const dist = haversineDistance(jobLoc, currentLoc); // meters
                    const GEOFENCE_RADIUS = 200; // meters

                    if (dist > GEOFENCE_RADIUS) {
                        // Check last event to avoid spamming
                        const { data: lastEvent } = await adminDb
                            .from('events')
                            .select('type')
                            .eq('workday_id', workday.id)
                            .eq('job_id', currentJob.id)
                            .order('timestamp', { ascending: false })
                            .limit(1)
                            .single();

                        if (!lastEvent || (lastEvent.type !== 'GEOFENCE_EXIT' && lastEvent.type !== 'JOB_COMPLETED')) {
                            // Create Event
                            const exitEvent = {
                                workday_id: workday.id,
                                type: 'GEOFENCE_EXIT',
                                timestamp: new Date(finalTimestamp).getTime(),
                                job_id: currentJob.id,
                                details: `Detected exit from job site (${Math.round(dist)}m away)`,
                                location_latitude: lat,
                                location_longitude: lon,
                                location_timestamp: new Date(finalTimestamp).getTime(),
                                location_accuracy: params.accuracy ? parseFloat(params.accuracy) : null
                            };
                            await adminDb.from('events').insert(exitEvent as any);
                        }
                    }
                }
            }
        }

        return new NextResponse('OK', { status: 200 });

    } catch (error: any) {
        console.error('Webhook Handler Error:', error);
        return new NextResponse(error.message || 'Internal Server Error', { status: 500 });
    }
}
