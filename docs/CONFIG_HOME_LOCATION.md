# TechTrack Configuration Guide

## Administrator: Setting Home Location

To configure the technician's home location for calculating return trip distance:

1. Open the `.env.local` file in the project root
2. Add the following lines (replace with actual coordinates):

```bash
NEXT_PUBLIC_TECHNICIAN_HOME_LAT=-15.5505
NEXT_PUBLIC_TECHNICIAN_HOME_LON=-46.6333
```

3. Restart the development server:
```bash
npm run dev
```

### Finding the Coordinates

You can find the latitude and longitude by:
- Using Google Maps: Right-click on the location → Click the coordinates at the top
- Using a GPS coordinates tool online
- Using the current location when the technician is at home (check browser console for coordinates)

### Example .env.local file:

```bash
GEMINI_API_KEY=your_key_here
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
NEXT_PUBLIC_TECHNICIAN_HOME_LAT=-15.5505
NEXT_PUBLIC_TECHNICIAN_HOME_LON=-46.6333
```

## How It Works

When a technician ends their workday, the system will:
1. Calculate distance from the last job location
2. To the configured home location (from .env.local)
3. Include this "return trip" distance in the total km for payment
