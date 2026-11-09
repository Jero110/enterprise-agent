# Connect to Enterprise

Ask your admin for an environment connection link and the reusable Enterprise token. The admin must authorize your email and assign your team first.

Add the environment using its pairing link or T3 Connect, then open **Connect Enterprise**. When the environment hosts your Enterprise, enter only your email and Enterprise token. Each connected client signs in independently; your name, team, permissions and personal conversation list follow your own identity. Disconnecting Enterprise signs out only your connection.

For an IDE that does not host an Enterprise, open **Connect Enterprise** in the header or **Settings → Enterprise** and enter the hub address and your email. The token is optional. Your conversations and files stay on your own environment; the hub is not added as an environment you can work in.

You can paste an existing `/pair#token=…` URL. This flow uses the URL's machine address and does not consume its one-time pairing code. The Enterprise token can be reused across computers; it is not saved in the client. Each connection receives its own sessions.

The hub must run a version supporting unified Enterprise sign-in. Use HTTPS, Tailscale or loopback for both the hub and your IDE connection. Plain HTTP to a LAN IP cannot safely carry the reusable token and is rejected before sign-in. Existing peer link transport restrictions still apply.

Disconnect Enterprise from **Settings → Enterprise**. A saved environment can be removed separately from **Settings → Connections**.

Your conversations stay in the normal conversation list. **CoWork Agents** groups shared conversations by owner, including your own. Expand a person's name to open a read-only transcript. Unshared conversations and people with no shared conversations do not appear.

To change access to your conversation and its subagents, open **Share with team** in the conversation composer and select **Team readable** or **Not shared**. Only the owner can change this setting. While connected to Enterprise, conversations without a recorded owner are hidden from your personal list.

To continue a published teammate conversation, open its transcript in **CoWork Agents** and select **Continue in my thread**. This creates your own new conversation with the source transcript as text context; it does not transfer files, checkpoints or the provider session.

Admins can assign additional areas under **Settings → Enterprise → Members**. These grants supplement the member's team area; they do not move the member to another team or grant lead review permissions. In **Conversation context**, choose any combination of your available areas. Conversation choices only narrow the access your admin granted and also apply to a new conversation before its first message.

## Read Enterprise from the CLI

This is an owner/script interface. The CLI uses the IDE owner’s saved Enterprise identity. It does not carry a provider thread identity or enforce that conversation’s knowledge toggles, so it is not a scoped interface for provider agents. Use the existing Knowledge MCP tools when those conversation restrictions must apply.

With your local T3 Code server running and connected to Enterprise, use:

```sh
t3 enterprise threads list
t3 enterprise threads show teammate@example.com <thread-id>
t3 enterprise knowledge list
t3 enterprise knowledge show global/overview.md
```

Thread commands read published conversations you currently have access to. The list includes owner emails and thread ids for `show`; unpublished conversations are omitted. A published transcript may be unavailable until its owner's IDE uploads it.

Knowledge commands read the global, team and other layers currently permitted by Enterprise. Copy a document path from `knowledge list` into `knowledge show`. Permissions are checked on every request; these commands do not read a local knowledge checkout.

All four commands support `--json` for scripts and `--base-dir <directory>` to select the running server's T3 home. They only read data; the text-only continuation action is available in the web client, not in this CLI.

Use `--page` to return one bounded page: up to 100 list entries, or up to 100 transcript messages and 50,000 text characters. Knowledge reads return up to 50,000 text characters. Without `--page`, commands collect all pages. JSON pages include continuation offsets; text output prints continuation flags on stderr. List commands accept `--cursor`; thread reads accept `--message-offset` and `--text-offset`; knowledge reads accept `--text-offset`. A nonzero offset also selects one-page output.

```sh
t3 enterprise threads list --page --json
t3 enterprise threads show teammate@example.com <thread-id> --page --message-offset 100 --json
t3 enterprise knowledge show global/overview.md --page --text-offset 50000 --json
```

The CLI creates a read-only local MCP session and revokes it on normal exit. This is the standard session with a 30-day expiry, so a process killed before cleanup can leave it valid until expiry. The CLI profile used to hide its transport is not a delegated authorization boundary.

## Ask an agent about cards and Cowork

In a new thread, ask “Lee las tarjetas del proyecto” or “¿Qué está haciendo Alex en Cowork?”. The agent can list and read cards for its current project, and published Cowork conversations available to this environment’s signed-in member. Unpublished conversations remain unavailable.

Proyectos appears only while you are signed in to an enterprise. Project boards are saved on the connected server, so browsers connected to that server use the same project data. Boards do not sync between separate environments or through the Enterprise hub. The native mobile app has no board editor yet.
