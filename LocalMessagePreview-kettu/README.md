# Local Message (preview) — Kettu / Vendetta

This is a port of the BetterDiscord `LocalMessagePreview.plugin.js` for **[Kettu](https://github.com/C0C0B01/Kettu)** (mobile Discord mod). **[KettuTweak](https://github.com/C0C0B01/KettuTweak)** only injects the loader into the iOS app; plugins are **Vendetta-style** JS loaded by Kettu, **not** `BdApi` classes.

### Differences from BetterDiscord

| BetterDesktop | Kettu |
|---------------|--------|
| `BdApi.Data` | `vendetta.plugin.storage` + `vendetta.storage.useProxy` |
| `BdApi.React` + DOM `<input>` | `vendetta.metro.common.React` + `Forms` (`FormInput`, `FormSwitch`, …) |
| `BdApi.Webpack.getModule` | `vendetta.metro.findByStoreName("ChannelStore")` etc. |
| `class` + `getSettingsPanel` | `{ onLoad, onUnload, settings }` export |
| `BdApi.UI.showToast` | `vendetta.ui.toasts.showToast` |

### Install

1. Host **`manifest.json`** and **`index.js`** at a URL that ends with `/` (plugin base).
2. In Discord: **Settings → Plugins → Install** (or add the plugin source URL your build uses).
3. Polymanifest expects a **`hash`** field; if updates misbehave, change `hash` in `manifest.json` after edits or use a plugin dev workflow from the Kettu Discord.

### Notes

- Open the target channel before injecting so the message list shows it.
- Payload shape matches the desktop Flux `MESSAGE_CREATE` pattern; if a future Discord mobile build changes stores/dispatcher behavior, this may need small adjustments.
