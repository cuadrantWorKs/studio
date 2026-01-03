# Deployment Guide

This application is configured for deployment on **Vercel** (recommended for ease) or **Docker/VPS** (for self-hosting).

## Prerequisites (Environment Variables)

Regardless of the deployment method, you **MUST** provide the following environment variables:

| Variable | Description | Required |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase Anon Key | Yes |
| `GROQ_API_KEY` | Your Groq API Key (for AI features) | Yes |
| `NEXT_PUBLIC_TECHNICIAN_HOME_LAT` | Latitude for technician's home base | No (Optional) |
| `NEXT_PUBLIC_TECHNICIAN_HOME_LON` | Longitude for technician's home base | No (Optional) |

---

## Option 1: Vercel (Recommended)

1.  **Push to GitHub**: Ensure your code is pushed to a GitHub repository.
2.  **Import Project**: Go to [vercel.com](https://vercel.com), click "New Project", and select your repository.
3.  **Configure Environment Variables**:
    *   In the "Environment Variables" section, add all the keys listed above.
4.  **Deploy**: Click "Deploy". Vercel will automatically detect the Next.js setup and build it.

> **Note**: The `next.config.mjs` is configured with `output: 'standalone'`. Vercel handles this automatically, but it doesn't hurt.

---

## Option 2: Docker / VPS

Navigate to your server via SSH and follow these steps.

### 1. Build the Docker Image

Run this command in the root of your project:

```bash
docker build -t techtrack .
```

### 2. Run the Container

Replace the values below with your actual keys:

```bash
docker run -d -p 3000:3000 \
  -e NEXT_PUBLIC_SUPABASE_URL="your_supabase_url" \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY="your_supabase_key" \
  -e GROQ_API_KEY="your_groq_key" \
  --name techtrack \
  techtrack
```

The app will be available at `http://your-server-ip:3000`.

### 3. (Optional) Using Nginx with Domain

If you want to use a subdomain (e.g., `app.yourdomain.com`), configure Nginx as a reverse proxy:

```nginx
server {
    listen 80;
    server_name app.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
