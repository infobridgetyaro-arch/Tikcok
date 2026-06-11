# BintuNet - Live Stream Control Panel

A modern, mobile-friendly web UI for controlling live-streaming using FFmpeg. Capture TikTok live streams and restream them to YouTube and/or Facebook simultaneously.

## Features

- Multiple simultaneous streams (unlimited)
- TikTok → YouTube/Facebook restreaming
- Live preview video player to verify TikTok user is live
- Real-time log output via WebSocket
- Mute/unmute during live stream (sends silent audio, no interruption)
- Auto-restart on failure
- Mobile/Desktop layout ratio selection
- Quality (best/720p/480p) and FPS (20/25/30) selection
- Sky-blue theme, mobile-friendly design
- Login protection (password: `bintunet`)

## Requirements

- **Node.js 20+**
- **FFmpeg**

## Installation & Setup

### Termux (Android)

```bash
# 1. Update Termux packages
pkg update && pkg upgrade -y

# 2. Install required tools
pkg install -y nodejs ffmpeg git

# 3. Clone or copy your project
# Option A: From GitHub
git clone https://github.com/YOUR_USERNAME/bintunet.git
cd bintunet

# Option B: Copy from device storage
termux-setup-storage
cp -r ~/storage/shared/bintunet ~/bintunet
cd ~/bintunet

# 4. Install dependencies
npm install

# 5. Build the app
npm run build

# 6. Start the app
npm run start
```

The app runs at **http://localhost:5000** — open it in your phone browser.

### Ubuntu / Linux

```bash
# 1. Update system
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Install FFmpeg
sudo apt install -y ffmpeg

# 4. Verify installations
node -v          # Should show v20.x.x
ffmpeg -version  # Should show ffmpeg version 6.x or 7.x

# 5. Clone or copy your project
git clone https://github.com/YOUR_USERNAME/bintunet.git
cd bintunet

# 6. Install dependencies
npm install

# 7. Build the app
npm run build

# 8. Start the app
npm run start
```

The app runs at **http://localhost:5000** — open it in your browser.

### Windows 10/11

```powershell
# 1. Install Node.js 20
# Download from: https://nodejs.org/en/download
# Run the installer, check "Add to PATH"

# 2. Install FFmpeg
# Download from: https://www.gyan.dev/ffmpeg/builds/
# Get "ffmpeg-release-essentials.zip"
# Extract to C:\ffmpeg
# Add C:\ffmpeg\bin to your system PATH:
#   Settings > System > About > Advanced system settings >
#   Environment Variables > Path > Edit > New > C:\ffmpeg\bin

# 3. Open Command Prompt or PowerShell, verify:
node -v
ffmpeg -version

# 4. Navigate to your project folder
cd C:\Users\YourName\Desktop\bintunet

# 5. Install dependencies
npm install

# 6. Build the app
npm run build

# 7. Start the app
npm run start
```

The app runs at **http://localhost:5000** — open it in your browser.

## Usage

1. Open **http://localhost:5000** in your browser
2. Login with password: **bintunet**
3. Click **Add Stream** to create a new stream card
4. Enter the TikTok username of someone who is currently live
5. Enter your YouTube Stream Key (and optionally Facebook Stream Key)
6. Choose quality, FPS, and layout ratio
7. Click **Start** to begin restreaming

## Notes

- The TikTok user must be **currently live** for streaming to work
- On Termux, TikTok extraction works best since it runs from a real mobile IP
- Facebook streaming is optional — leave the field empty if not needed
- Muting sends silent audio to keep the YouTube/Facebook connection alive
- FFmpeg must be installed and available in your system PATH
