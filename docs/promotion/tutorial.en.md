# Run DeepSeek Phone Harness in Five Minutes: Remote-Control Your Computer from Your Phone over 4G

> From zero to controlling DeepSeek Harness on your computer from your phone — in five steps. No public IP, no router config.

---

## What you need

| Thing | Notes |
| --- | --- |
| Computer | Windows / macOS / Linux, Node.js 22+ installed |
| DeepSeek Harness | `dsh web` running on the computer (listening on `127.0.0.1:3080`) |
| Phone | Any mobile browser (Safari / Chrome) |
| Tailscale | (Optional) the key to reach your computer over 4G/5G — free |

## Step 1: Clone and configure on the computer

```bash
git clone https://github.com/2903077918-lgtm/DeepSeek-phone-harness.git
cd DeepSeek-phone-harness

# The template contains no secrets
cp config.example.json config.json
```

Open `config.json` and set the `token` field to your own access token (a random string — e.g. generate one with `openssl rand -hex 24`).

## Step 2: Start the agent

```bash
node agent.mjs --mode=both
```

You're good when you see:

```
deepseekharness-relay Agent v0.4.0
  console: http://<your-IP>:8788
  Token:  <your access token>
```

## Step 3: Connect phone and computer (4G/5G works)

Pick one:

**Option A: Tailscale (recommended — works over 4G/5G)**

1. Install Tailscale on both the computer and the phone, signed into the same account
2. On the phone open `http://<computer's Tailscale IP>:8788/`
   - Tailscale IPs look like `100.x.x.x`; check with `tailscale ip` on the computer
3. That IP works even when the phone is on 4G/5G — **no WiFi needed**

**Option B: Same WiFi (LAN only)**

Connect the phone to the same WiFi as the computer and open `http://<computer LAN IP>:8788/`.

## Step 4: Connect from the phone

1. On the page, enter:
   - **Server address**: `http://<computer IP>:8788`
   - **Access token**: the one you put in `config.json`
2. Tap **Connect** → pick a workspace → start chatting

## Step 5: Go

Try these:

- Send a task: `List the 3 largest files in my downloads folder`
- Watch it work: tool cards show in real time **which file was read and which command ran**; tap a card for full arguments and results
- Approve / answer: when the agent requests authorization or asks a question, cards appear in the message stream — allow / reject / answer
- Switch models: tap the model name at the top to switch between deepseek-v4-flash / v4-pro
- Run the terminal: open **Terminal** from the drawer and execute commands on the computer
- Browse code: open **Files** from the drawer and explore projects

## FAQ

**Q: The page won't open on the phone?**
A: Confirm port 8788 is listening on the computer (check the startup log); with Tailscale, confirm both devices are online.

**Q: A task stays "running" forever?**
A: Check the message stream for a **"Your answer needed"** card — the agent may be waiting on you. Answer it and it continues.

**Q: I want public access without Tailscale?**
A: Use the Cloudflare Worker option (`cloud-relay/`, one `wrangler deploy`), or reverse-proxy yourself — and always keep token auth on.

**Q: Rotate the token?**
A: Change `token` in `config.json`, restart the agent, then use **Modify connection** in the phone's settings to re-enter it.

## Security notes

- Never commit `config.json` to any public repo (the project already ignores it via `.gitignore`)
- Only expose port 8788 to trusted networks; if exposed publicly, use a reverse proxy + a strong token
- Every risky operation first shows an approval card — you decide

---

Once it's running, come chat with us:

> **https://github.com/2903077918-lgtm/DeepSeek-phone-harness**

A star would mean the world — it's how this project grows.
