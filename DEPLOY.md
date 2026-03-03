# Deploying Audio-Transcription on Ubuntu (LAN)

## Option A: Docker (Recommended)

### 1. Install Docker on the Ubuntu Server

```bash
# Install Docker + Compose plugin in one shot
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Log out and back in for group change to take effect
```

### 2. Get the Code onto the Server

**Option 1 — Git clone** (if repo is on GitHub):
```bash
git clone https://github.com/<your-user>/Audio-Transcription.git
cd Audio-Transcription
```

**Option 2 — SCP from your Mac**:
```bash
# On your Mac, run:
cd ~/MyLab/MyProjects
rsync -avz --exclude node_modules --exclude .next --exclude .git \
  Audio-Transcription/ <user>@<server-ip>:~/Audio-Transcription/
```

### 3. Set the API Key

Create a `.env` file in the project root **on the server**:

```bash
cd ~/Audio-Transcription
echo 'GEMINI_API_KEY=your_actual_key_here' > .env
```

### 4. Build & Run

```bash
docker compose up -d --build
```

First build takes ~2-3 min. Subsequent builds are cached and much faster.

### 5. Access the App

Find your server's LAN IP:
```bash
hostname -I | awk '{print $1}'
```

Open `http://<server-ip>:3000` from any device on your network.

### 6. Useful Commands

```bash
# View logs
docker compose logs -f

# Stop the app
docker compose down

# Rebuild after code changes
docker compose up -d --build

# Full reset (remove image cache too)
docker compose down --rmi all
docker compose up -d --build
```

---

## Option B: Bare Metal (Node.js + systemd)

### 1. Install Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2. Get the Code & Install Dependencies

```bash
cd ~/Audio-Transcription
npm ci
```

### 3. Set the API Key

```bash
echo 'GEMINI_API_KEY=your_actual_key_here' > .env.local
```

### 4. Build for Production

```bash
npm run build
```

### 5. Create a systemd Service

```bash
sudo tee /etc/systemd/system/audio-transcription.service > /dev/null <<'EOF'
[Unit]
Description=Audio Transcription App
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/home/$USER/Audio-Transcription
EnvironmentFile=/home/$USER/Audio-Transcription/.env.local
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=on-failure
Environment=NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0

[Install]
WantedBy=multi-user.target
EOF
```

> **Note**: Replace `$USER` with your actual username if the variable doesn't expand, and adjust `WorkingDirectory` if your path differs.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now audio-transcription
```

### 6. Manage the Service

```bash
sudo systemctl status audio-transcription   # check status
sudo journalctl -u audio-transcription -f    # view logs
sudo systemctl restart audio-transcription   # restart after updates
```

---

## Firewall

If UFW is enabled, open the port:

```bash
sudo ufw allow 3000/tcp
```

## Updating the App

```bash
# Pull latest code
git pull  # or rsync again

# Docker:
docker compose up -d --build

# Bare metal:
npm ci && npm run build
sudo systemctl restart audio-transcription
```
