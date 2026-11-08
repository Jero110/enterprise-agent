# Connect to Enterprise

Ask your admin for the Enterprise hub's environment URL and reusable Enterprise token. The admin must authorize your work email first.

In the desktop app or a web client connected to your IDE, open **Connect Enterprise** in the header or **Settings → Enterprise**. Enter the hub URL, your email and the Enterprise token, then select **Connect**. This connects Enterprise and saves the hub as an environment. Your team, role and knowledge access come from the hub automatically.

You can paste an existing `/pair#token=…` URL. This flow uses the URL's machine address and does not consume its one-time pairing code. The Enterprise token can be reused across computers; it is not saved in the client. Each connection receives its own sessions.

The hub must run a version supporting unified Enterprise sign-in. Use HTTPS, Tailscale or loopback for both the hub and your IDE connection. Plain HTTP to a LAN IP cannot safely carry the reusable token and is rejected before sign-in. Existing peer link transport restrictions still apply.

Disconnect Enterprise from **Settings → Enterprise**. A saved environment can be removed separately from **Settings → Connections**.

Your conversations stay in the normal conversation list. **Team Agents** lists everyone in your team, including you, and groups conversations by owner. Each member shows whether they currently have shared conversations. Conversations that are not shared show only their title, owner and status; shared conversations open as read-only transcripts.

To change access to your conversation and its subagents, open **Share with team** in the conversation header and select **Read-only** or **Not shared**. Only the owner can change this setting. While connected to Enterprise, conversations without a recorded owner are hidden from your personal list.
