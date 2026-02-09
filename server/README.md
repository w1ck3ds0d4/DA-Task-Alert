# Oracle Free Tier Server Deployment

Run DA Task Alert 24/7 on an Oracle Cloud free-tier VM.

## 1. Create Oracle Cloud Account

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com) (Always Free tier, no credit card charge)
2. Create a **Compute Instance**:
   - Shape: `VM.Standard.E2.1.Micro` (Always Free)
   - Image: Ubuntu 22.04+
   - Generate SSH keys during creation

## 2. Connect and Install

```bash
ssh ubuntu@<your-vm-ip>

sudo apt update && sudo apt install -y python3 python3-pip git

git clone https://github.com/WickedSoda/DA-Task-Alert.git /opt/da-task-alert
cd /opt/da-task-alert/local
pip3 install -r requirements.txt
```

## 3. Configure

```bash
cp /opt/da-task-alert/shared/config.example.env /opt/da-task-alert/.env
nano /opt/da-task-alert/.env
```

Set at minimum:
- `NTFY_TOPIC` - your ntfy topic (long random string)
- `DA_SESSION_COOKIE` - your session cookie (e.g., `conv_session=eyJp...`)
- `DESKTOP_NOTIFY=false` - no desktop on headless server

## 4. Test

```bash
cd /opt/da-task-alert/local
python3 monitor.py --once
```

Check your phone for a notification. If you see "Session expired", your cookie is invalid - re-copy it from the browser.

## 5. Set Up as Service

```bash
sudo cp /opt/da-task-alert/server/da-task-alert.service /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable da-task-alert
sudo systemctl start da-task-alert
```

Verify it's running:
```bash
sudo systemctl status da-task-alert
journalctl -u da-task-alert -f
```

## 6. Updating Session Cookie

When your session expires (you'll get an ntfy alert), SSH in and update:

```bash
nano /opt/da-task-alert/.env
# Update DA_SESSION_COOKIE with the new conv_session value
sudo systemctl restart da-task-alert
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Service won't start | `journalctl -u da-task-alert -e` |
| No notifications | Verify `NTFY_TOPIC` matches your phone app subscription |
| Session expired immediately | Make sure you copied the full `conv_session=...` value |
| Python not found | `sudo apt install python3 python3-pip` |
