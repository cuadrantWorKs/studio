#!/bin/bash

# ==============================================================================
# TechTrack GPS Simulator - Flipper Zero Edition 🐬
# ==============================================================================

# Colors & Styles
ORANGE='\033[38;5;214m'
WHITE='\033[37m'
BLACK='\033[30m'
BG_ORANGE='\033[48;5;214m'
BOLD='\033[1m'
NC='\033[0m'

# Configuration
WEBHOOK_URL="https://studio-jade-two.vercel.app/api/webhooks/traccar"
DEVICE_ID=${1:-"ricardo-iphone"}
LAT=${2:-"-34.6037"}
LON=${3:-"-58.3816"}
STEP_METERS=${4:-"100"}
INTERVAL=30

# Calculate increments based on meters
# 1 degree lat ≈ 111,132 meters
# 1 degree lon ≈ 111,320 * cos(lat) meters
LAT_INC=$(echo "scale=10; $STEP_METERS / 111132" | bc -l)
# Simple approximation for longitude based on current latitude
LON_INC=$(echo "scale=10; $STEP_METERS / (111320 * 0.82)" | bc -l) # 0.82 is approx cos(-34.6)

# Helper: Box Drawing
draw_box_top()    { echo -e "${ORANGE}┌──────────────────────────────────────────────────────────┐${NC}"; }
draw_box_bottom() { echo -e "${ORANGE}└──────────────────────────────────────────────────────────┘${NC}"; }
draw_line()       { echo -e "${ORANGE}├──────────────────────────────────────────────────────────┤${NC}"; }

# ASCII Dolphin (Flipper Style)
draw_dolphin() {
    echo -e "${ORANGE}     .-''-.${NC}"
    echo -e "${ORANGE}   .' .-.  )   ${WHITE}TechTrack GPS${NC}"
    echo -e "${ORANGE}  / .'/  ) /   ${WHITE}Simulator v1.1${NC}"
    echo -e "${ORANGE} ( (  ( / /    ${WHITE}Dolphin Mode: ON${NC}"
    echo -e "${ORANGE}  \ \  ) )     ${WHITE}Device: $DEVICE_ID${NC}"
    echo -e "${ORANGE}   '._'._.'${NC}"
}

clear_screen() {
    clear
}

draw_ui() {
    local status=$1
    local http_status=$2
    local last_ts=$3
    
    clear_screen
    draw_box_top
    draw_dolphin
    draw_line
    
    printf "${ORANGE}│${NC}  ${BOLD}LOCATION DATA${NC}                                        ${ORANGE}│${NC}\n"
    printf "${ORANGE}│${NC}  LAT: ${WHITE}%-15s${NC} LON: ${WHITE}%-15s${NC}      ${ORANGE}│${NC}\n" "$LAT" "$LON"
    printf "${ORANGE}│${NC}  STEP: ${ORANGE}%-10s m${NC}    INC: ${ORANGE}%-14s${NC}      ${ORANGE}│${NC}\n" "$STEP_METERS" "$LAT_INC"
    draw_line
    
    printf "${ORANGE}│${NC}  ${BOLD}SIMULATION STATUS${NC}                                    ${ORANGE}│${NC}\n"
    if [ "$status" == "SENDING" ]; then
        printf "${ORANGE}│${NC}  STATUS: ${BG_ORANGE}${BLACK} SENDING... ${NC}                               ${ORANGE}│${NC}\n"
    elif [ "$status" == "IDLE" ]; then
        printf "${ORANGE}│${NC}  STATUS: ${WHITE}WAITING...${NC}                                 ${ORANGE}│${NC}\n"
    fi
    printf "${ORANGE}│${NC}  HTTP:   ${WHITE}%-10s${NC} TIME: ${WHITE}%-20s${NC}   ${ORANGE}│${NC}\n" "$http_status" "$last_ts"
    draw_line
    
    # Simple Progress Bar Simulation (Visual only)
    printf "${ORANGE}│${NC}  [${ORANGE}■■■■■■■■■■■■■■${WHITE}░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░${NC}] ${INTERVAL}s  ${ORANGE}│${NC}\n"
    draw_box_bottom
}

# Dependency Check
if ! command -v bc &> /dev/null; then
    echo "This script requires 'bc'. Please install it."
    exit 1
fi

LAST_STATUS="IDLE"
HTTP_CODE="---"
TIMESTAMP="N/A"

while true; do
    # Get Argentinian Time (UTC-3)
    TIMESTAMP=$(date +"%H:%M:%S")
    
    # Draw UI - Sending state
    draw_ui "SENDING" "$HTTP_CODE" "$TIMESTAMP"
    
    # Payload
    FULL_TS=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    
    PAYLOAD=$(cat <<EOF
{
  "location": {
    "timestamp": "$FULL_TS",
    "coords": {
      "latitude": $LAT,
      "longitude": $LON,
      "accuracy": 10,
      "speed": 5.0,
      "heading": 0,
      "altitude": 0
    },
    "is_moving": true,
    "event": "motionchange",
    "battery": { "level": 0.85, "is_charging": false },
    "activity": { "type": "on_foot" }
  },
  "device_id": "$DEVICE_ID"
}
EOF
)

    # Send Request
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD")

    # Increment
    LAT=$(echo "scale=10; $LAT + $LAT_INC" | bc)
    LON=$(echo "scale=10; $LON + $LON_INC" | bc)

    # Draw UI - IDLE state
    draw_ui "IDLE" "$HTTP_CODE" "$TIMESTAMP"

    sleep $INTERVAL
done
