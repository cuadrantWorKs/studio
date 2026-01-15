# Deployment Guide

This application is designed to be deployed on **Vercel** with a **Supabase** backend.
It includes a built-in **Traccar Receiver** (`/api/webhooks/traccar`) so you DO NOT need to host a separate Traccar server.

## 1. Environment Variables (Required)

You **MUST** set these environment variables in your Vercel Project Settings:

| Variable | Description | Required |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase Anon Key (public) | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | **CRITICAL**: The "Service Role" secret key. Used by the Traccar webhook to write location data securely. | **YES** |
| `GROQ_API_KEY` | Your Groq API Key (for AI summaries) | Yes |
| `NEXT_PUBLIC_TECHNICIAN_HOME_LAT`| Home base Latitude (e.g. `-34.6037`) | Optional |
| `NEXT_PUBLIC_TECHNICIAN_HOME_LON`| Home base Longitude (e.g. `-58.3816`) | Optional |

> **Where to find `SUPABASE_SERVICE_ROLE_KEY`**:
> Go to Supabase Dashboard -> Project Settings -> API -> Service Role key (secret).

---

## 2. Deploying to Vercel

1.  **Push to GitHub**: Ensure your latest code (including the `traccar` webhook) is pushed.
2.  **Import Project**: Go to [vercel.com](https://vercel.com), click "Add New...", select your Git repository.
3.  **Configure Env Vars**: Add the keys listed above.
4.  **Deploy**: Click "Deploy".
5.  **Copy URL**: Once finished, copy your production URL (e.g., `https://techtrack-app.vercel.app`).

---

## 3. Configuring Traccar Client (Mobile App)

To start feeding data into your Vercel app:

1.  Download **Traccar Client** (iOS/Android) - *The app with the orange icon*.
2.  **Device Identifier**: Enter the **User UUID** or the specific ID configured in code (e.g. `ricardo-iphone`).
3.  **Server URL**: `https://[YOUR-VERCEL-DOMAIN]/api/webhooks/traccar`
    *   *Example*: `https://techtrack-app.vercel.app/api/webhooks/traccar`
    *   **Note**: Ensure it starts with `https://`.
4.  **Frequency**: Set to `30` or `60` seconds (High precision) or `300` (Battery saving).
5.  **Service Status**: Turn **ON**.

## 4. Troubleshooting

*   **"GPS Offline" / Red Status in App**:
    *   Check if Traccar Client is running and "Service Status" is ON.
    *   Check if the **Device Identifier** matches what the app expects (e.g. `ricardo-iphone`).
    *   Check Vercel Logs for errors in `/api/webhooks/traccar`.
    *   Verify `SUPABASE_SERVICE_ROLE_KEY` is set in Vercel.

*   **Database not updating**:
    *   Check the `raw_locations` table in Supabase.
    *   If rows are missing, the webhook might be failing (check Vercel logs).
