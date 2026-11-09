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

## Find knowledge and request access

On web and desktop, open **Conversation context → Context** to browse company knowledge across Metrics, Business, AI and Data, grouped by area. Use **Find a node** to search node titles. An empty graph means no knowledge has been loaded yet; an admin can start from **Ingest**.

You can see an area's node previews even without access to its documents. A locked node shows its title, description, area and private status, never its body. Treat preview titles and descriptions as visible to all Enterprise members; keep sensitive facts in the body.

Select a locked node and choose **Request access**. The area's lead or an admin reviews the request in **Changes**. Asking does not grant access. After approval, the selected node reveals its body without reopening the conversation; choose **Check access** if you want to check immediately. Revoking access makes the body unavailable again. Direct document reads and content search remain limited to knowledge you can access.

## Load organization and knowledge

Enrolled members use **Conversation context → Ingest** on web or desktop. Choose **Personal** for knowledge only you own, an accessible **Area** for proposals reviewed by its lead or an admin, or **General** for proposals reviewed by an admin. Drop or choose files from your device, or paste public HTTPS links to plain text or Markdown. Authenticated websites are not supported. You can also enter a note about missing knowledge without files; a note is guidance, not evidence. Ingestion uses your selected agent model and subscription. Review proposals in **Changes**; starting a run does not approve or apply them.

A public GitHub repository root URL imports supported text files from its `raw/` folder at a fixed revision, not the GitHub webpage. If `raw/_manifest.csv` declares access areas, only files for the selected destination are read (`general` maps to General); import other areas separately. Generated `demo/` and `_build/` content is excluded. PDF, Excel and SQLite files need extractors and are not processed as text.

You can also upload plain-text meeting notes with a date, invitees, summary, agreed or pending decisions, next-step owners and details. Notes produce proposals, not executed tasks or automatic authorization.

Admins can also download the `organization.yaml` and `areas.yaml` templates. Upload the two completed YAML files, preview the added, changed and removed people and areas, then confirm the import. To add one member or change an area without replacing the organization, use Organization settings. Give each area at most one lead; that lead reviews access requests. Check removals carefully: removing a person revokes their access. Open **Organization** to see area leads and reporting relationships.

### Import database schemas

In **Ingest → Connectors**, choose Postgres or Supabase, select the destination area and supply a database connection URL. Use a database account with only the permissions needed to read schema metadata. Connecting proposes Data-layer nodes describing tables and columns for review; it never imports table rows. A promotions table schema, for example, does not reveal the campaign's actual discount.

Connection URLs stay in the hub's secret store. Use **Refresh schema** to propose updated schemas. **Disconnect** removes the saved connection URL but keeps accepted knowledge nodes. Snowflake, BigQuery, MySQL, Google Sheets and Google Drive are not available yet.

## Share personal knowledge

Open **Conversation context → Sharing** and choose a specific member or area. To share a local skill or node for the first time, enter its title and description, choose its kind and layer, then paste its content or select a Markdown/text file and choose **Publish copy and share**. You can also grant access to an already published personal item. These are copies you choose to publish, not an automatic upload of your private local wiki, personal transcripts or files. For example, Francisco can share his published RAG skill with María without sharing the rest of his personal knowledge.

Use **Shared by me** to review recipients and revoke an individual grant. Stop sharing an item with everyone to unpublish it. **Shared with me** lists items others have shared with you. Area documents are not shared through this tab; their access is managed through area membership and requests. Personal knowledge sharing is separate from publishing a conversation with **Share with team**.

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

Boards are one space per signed-in member, saved on the connected server: you see and manage only your own boards, the same ones in every project, from any browser connected to that server. Without an enterprise identity they fall back to a shared space. Agents you run read and move cards on your boards only (`project_board_get`, `project_board_save`, `project_board_move_card`). Boards from before this change were kept in the shared space. In Proyectos, import existing browser boards; the original browser copy is kept. Boards do not sync between separate environments or through the Enterprise hub. The native mobile app has no board editor yet.

On the server host, use `t3 board` to manage boards. `--base-dir <directory>` selects another running local server. For example:

```sh
t3 board list
t3 board add "Sprint"
t3 board card add <board-id> "Review ledger" --status in_progress --assignees "AB,CD"
t3 board card edit <board-id> <card-id> --title "Review totals" --due-date 2026-12-01
t3 board card remove <board-id> <card-id>
t3 board card move <card-id> --board <board-id> --status complete
t3 board rename <board-id> "Next sprint"
t3 board remove <board-id>
```

The CLI acts as the server host and requires a running server; it does **not** sign in as a person, so it edits the shared space unless the server host session is enrolled as a member. Cards also accept `--description`, `--priority`, `--tags` and `--due-date`; use comma-separated assignees or tags, and `none` to clear a priority or due date. Changes use the current revision and reject concurrent edits rather than overwriting them.
