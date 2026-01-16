
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const deviceId = process.env.NEXT_PUBLIC_TRACCAR_DEVICE_ID || 'ricardo-iphone';

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkGPS() {
    console.log(`Checking GPS for device: ${deviceId}`);

    const { data, error } = await supabase
        .from('raw_locations')
        .select('*')
        .eq('device_id', deviceId)
        .order('timestamp', { ascending: false })
        .limit(1);

    if (error) {
        console.error('Error fetching data:', error);
        return;
    }

    if (data && data.length > 0) {
        const latest = data[0];
        console.log('Latest location found:');
        console.log(latest);

        const timestamp = new Date(latest.timestamp).getTime();
        const now = Date.now();
        const diff = now - timestamp;
        const diffMinutes = diff / 60000;

        console.log(`Timestamp: ${new Date(timestamp).toISOString()}`);
        console.log(`Server Time: ${new Date(now).toISOString()}`);
        console.log(`Difference: ${diffMinutes.toFixed(2)} minutes`);

        if (diffMinutes > 60) {
            console.log('STATUS: STALE (> 60 mins)');
        } else {
            console.log('STATUS: FRESH');
        }
    } else {
        console.log('No data found for this device.');
    }
}

checkGPS();
