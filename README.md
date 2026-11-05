# Web Page CCTV RTSP Dashboard

A local web dashboard for viewing Hikvision NVR RTSP channels. The app uses:
- FastAPI for camera management/API
- MediaMTX to pull RTSP from the NVR and expose HLS
- hls.js in the browser
- JSON file storage (no database service required)

## 1. Requirements

- Windows 64-bit
- Python 3.11 or newer (Python 3.12 recommended; Python 3.14 works with the updated dependency list)
- MediaMTX Windows AMD64 binary
- Browser: current Microsoft Edge or Chrome
- Network reachability from the Windows Server to NVR RTSP port (usually TCP 554)

## 2. Install

1. Extract this project to `C:\CCTV\`.
2. Install Python 3.12 and enable "Add Python to PATH".
3. Download the Windows AMD64 MediaMTX release from:
   https://github.com/bluenviron/mediamtx/releases
4. Extract `mediamtx.exe` into `C:\CCTV\` (same folder as `app.py`).
5. Open PowerShell as Administrator and run:

   ```powershell
   cd C:\CCTV
   Set-ExecutionPolicy -Scope Process Bypass
   .\install.ps1
   ```

6. Start the app:

   ```bat
   start.bat
   ```

7. Open `http://localhost:8080` on the server, or `http://IP-WINDOWS-SERVER:8080` from a workstation.

## 3. Windows Firewall

Allow inbound TCP 8080 (dashboard) and TCP 8888 (HLS) from your trusted monitoring LAN. If you later use WebRTC, also plan for UDP 8189 and TCP 8889. Do not expose these ports directly to the public internet.

Example elevated PowerShell:

```powershell
New-NetFirewallRule -DisplayName "CCTV Dashboard" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
New-NetFirewallRule -DisplayName "CCTV HLS" -Direction Inbound -Protocol TCP -LocalPort 8888 -Action Allow
```

For production, restrict `-RemoteAddress` to your CCTV/management subnet.

## 4. Add Hikvision camera

In the web UI choose **Add Camera** and enter a unique name and RTSP URL.

Common Hikvision RTSP patterns:

- Main stream channel 1: `rtsp://USER:PASSWORD@NVR_IP:554/Streaming/Channels/101`
- Sub stream channel 1: `rtsp://USER:PASSWORD@NVR_IP:554/Streaming/Channels/102`
- Main stream channel 2: `rtsp://USER:PASSWORD@NVR_IP:554/Streaming/Channels/201`
- Sub stream channel 2: `rtsp://USER:PASSWORD@NVR_IP:554/Streaming/Channels/202`

General formula:
- Main stream: `.../Streaming/Channels/` + channel number + `01`
- Sub stream: `.../Streaming/Channels/` + channel number + `02`

Confirm exact channel numbering and RTSP access in the NVR configuration/manual. Enable RTSP and create a dedicated read-only viewer account if the NVR supports it. Avoid using the NVR administrator account.

## 5. Layout and playback

Choose 6, 16, 32 or 64 tiles. The grid shows configured cameras in order and empty tiles as not configured. Double-click a tile for browser fullscreen.

The dashboard currently uses HLS for broad browser compatibility. HLS introduces buffering/latency (often several seconds). MediaMTX also has WebRTC enabled in its config, but this starter frontend does not yet implement WebRTC playback. For low-latency live control-room use, add a WebRTC player and configure ICE candidates/firewall accordingly.

## 6. Important performance and security notes

- RTSP is pulled on demand per camera, and MediaMTX closes an unused source after 30 seconds.
- 32/64 streams can consume substantial NVR session capacity, Windows CPU/network bandwidth, and browser decoding resources. Start with substreams for multi-camera grids; use main stream for single-camera fullscreen.
- A 1080p stream at 2–4 Mbps means 64 simultaneous streams can require roughly 128–256 Mbps before overhead. Measure actual bitrate.
- Credentials are stored in `data/cameras.json` and copied into `mediamtx.yml`. Restrict NTFS permissions on the application folder and back up these files securely. Use a dedicated low-privilege NVR account.
- This starter app has no user login, role-based access, audit log, or TLS. Keep it on a trusted LAN/VPN. Do not port-forward it to the internet.
- HLS URLs are reachable on port 8888. Restrict network access to trusted users.
- Browser HLS.js is loaded from jsDelivr CDN; internet access is required for that script. For offline networks, download hls.min.js and serve it locally.

## 7. Troubleshooting

**Black video / Stream unavailable**
1. From Windows Server test NVR reachability: `Test-NetConnection NVR_IP -Port 554`
2. Verify RTSP URL, username/password, channel index, and NVR RTSP enablement.
3. Try the URL in VLC from the Windows Server.
4. Check `data\mediamtx.log`.
5. Ensure TCP 8888 is reachable from the browser client.

**MediaMTX won't start**
- Ensure `mediamtx.exe` is in the same folder as `app.py`.
- Check `data\mediamtx.log`.
- Check port conflicts: `netstat -ano | findstr ":8888"` and `netstat -ano | findstr ":8554"`.

**No sound**
- This dashboard is designed for silent multi-view monitoring. Browser autoplay is muted by design. Add an audio control only for selected camera playback.

## 8. Run as a Windows service

For a production installation, use a service wrapper such as NSSM or configure Task Scheduler to start `start.bat` at system startup under a dedicated Windows service account. Ensure the working directory is the project folder.

## 9. Project structure

```text
CCTV/
  app.py
  requirements.txt
  install.ps1
  start.bat
  mediamtx.exe              # download separately
  mediamtx.yml              # generated automatically
  data/
    cameras.json
    mediamtx.log
  static/
    index.html
    style.css
    app.js
```
