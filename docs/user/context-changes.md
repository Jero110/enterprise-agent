# Context changes

On web and desktop, open **Conversation context → Changes**, or open **Context changes** from Enterprise settings. On mobile, open **Settings → Environments → [your environment] → Context changes**. The inbox shows changes you authored, changes awaiting your review, and resolved history. Open a proposal to read its reason, reviewers, and attached files.

Admins load files from **Conversation context → Ingest** on web and desktop, not from the review inbox. To stage a file proposal, choose a personal recipient, an area, or company, enter a reason, and pick files from your device. Files are uploaded to the connected Enterprise hub, including over remote connections. This stages a proposal; it does **not** update current knowledge or agent context. For bucket processing, later uploads and note-only runs, see [Load organization and knowledge](./enterprise.md#load-organization-and-knowledge).

Only the personal recipient can approve or reject personal proposals. Area leads for that area (and admins) review area proposals; admins review company proposals. Authors can track their submissions even when they cannot decide them. Approval of a staged file upload is not the same as applying a knowledge node: a received upload remains out of current context until processed into node proposals and those proposals are approved. Rejection leaves current context unchanged.

An **area access** proposal is different from a content change. Check the requester and destination area before approving: approval grants access to that area, not just the node that prompted the request. The requester can then read the selected node without reloading. Rejection leaves the node's safe graph preview visible but does not reveal its body.
