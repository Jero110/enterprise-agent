# Connect to Enterprise

An admin first authorizes your email in **Settings → Enterprise**. To create an invite, the admin gets a fresh pairing code from the hub's **Connections** settings and enters the hub's HTTPS or Tailscale address, that pairing code, and the Enterprise token in **Settings → Enterprise → Create an Enterprise invite**. Generate a separate invite for each computer; pairing codes work once.

On each computer, enable **Linked environments** in **Settings → Labs**, then open **Settings → Enterprise → Connect Enterprise** and enter your email and that computer's invite. Disconnect from the same settings page when you no longer need access.

Treat the invite as a secret: it contains the reusable Enterprise token encoded, **not encrypted**. A plain HTTP address on a local network will not work; use HTTPS or a Tailscale address for the hub.
