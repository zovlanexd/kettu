/**
 * Kettu / Vendetta-compatible port of LocalMessagePreview (BetterDiscord).
 * Kettu evals: vendetta=>{ return <this file> } — so this file must be an EXPRESSION.
 * Use an IIFE so `vendetta` is in scope (see Kettu src/core/vendetta/plugins.ts evalPlugin).
 */
(() => {
  const {
    metro,
    metro: { common },
    ui: { toasts: { showToast: toast } },
    storage,
    plugin,
  } = vendetta;

  const React = common.React;
  const { useCallback } = React;
  const { FluxDispatcher } = common;
  const { View, ScrollView } = common.ReactNative;
  const { TableRow, TableRowGroup, Stack, TableSwitchRow } = common.components;
  const findRedesignComponent = (name) => metro.findByProps(name)?.[name];
  const TextInput = findRedesignComponent("TextInput");
  const Button = findRedesignComponent("Button");

  function InputRow({ label, value, onChange, placeholder, isClearable }) {
    return React.createElement(TableRow, {
      label,
      subLabel: React.createElement(
        View,
        { style: { marginTop: 8 } },
        React.createElement(TextInput, {
          placeholder,
          value,
          onChange,
          isClearable,
        }),
      ),
    });
  }

  function ensureShape(d) {
    if (typeof d.channelId !== "string") d.channelId = "";
    if (typeof d.userId !== "string") d.userId = "";
    if (typeof d.message !== "string") d.message = "";
    if (typeof d.showEmbedPreview !== "boolean") d.showEmbedPreview = false;
    if (typeof d.embedImageUrl !== "string") d.embedImageUrl = "";
    if (typeof d.autoReplayOnLoad !== "boolean") d.autoReplayOnLoad = true;
    if (!Array.isArray(d.cached)) d.cached = [];
  }

  function cloneForStorage(message) {
    try {
      return JSON.parse(JSON.stringify(message));
    } catch {
      return null;
    }
  }

  function genSnowflake() {
    const ts = BigInt(Date.now());
    const rand = BigInt(Math.floor(Math.random() * 0xfffff));
    return String((ts << 22n) + rand);
  }

  function getChannelStore() {
    return metro.findByStoreName("ChannelStore");
  }

  function getUserStore() {
    return metro.findByStoreName("UserStore");
  }

  function buildPayload(data) {
    ensureShape(data);
    const channelId = data.channelId.trim();
    const userId = data.userId.trim();
    if (!channelId || !userId) throw new Error("Set both channel ID and user ID.");

    const ChannelStore = getChannelStore();
    const UserStore = getUserStore();
    if (!ChannelStore?.getChannel) throw new Error("Channel store not found.");
    if (!UserStore?.getUser) throw new Error("User store not found.");

    const channel = ChannelStore.getChannel(channelId);
    const guildId = channel?.guild_id ?? null;

    const cachedUser = UserStore.getUser(userId);
    const author = cachedUser
      ? { ...cachedUser }
      : {
          id: userId,
          username: "unknown-user",
          discriminator: "0",
          avatar: null,
          bot: false,
          global_name: "Unknown user",
        };

    const messageId = genSnowflake();
    const now = new Date().toISOString();
    const text = data.message ?? "";

    const embeds =
      data.showEmbedPreview && text.trim().length > 0
        ? [
            {
              type: "rich",
              description: text,
              ...(data.embedImageUrl?.trim()
                ? {
                    image: {
                      url: data.embedImageUrl.trim(),
                      proxy_url: data.embedImageUrl.trim(),
                      width: 400,
                      height: 300,
                    },
                  }
                : {}),
            },
          ]
        : [];

    const message = {
      id: messageId,
      type: 0,
      content: data.showEmbedPreview ? "" : text,
      channel_id: channelId,
      guild_id: guildId,
      attachments: [],
      embeds,
      mentions: [],
      mention_roles: [],
      mention_channels: [],
      mention_everyone: false,
      pinned: false,
      tts: false,
      nonce: messageId,
      blocked: false,
      ignored: false,
      flags: 0,
      reactions: [],
      author,
      timestamp: now,
      edited_timestamp: null,
      state: "SENT",
    };

    return {
      type: "MESSAGE_CREATE",
      channelId,
      guildId,
      message,
      optimistic: false,
      isPushNotification: false,
    };
  }

  let _fallbackTimer = null;
  let _connUnsub = null;
  let _autoReplayedThisSession = false;

  function replayCached(cfg, withToast = true) {
    try {
      ensureShape(cfg);
      for (const msg of cfg.cached) {
        const cid = String(msg.channel_id || "");
        if (!cid) continue;
        FluxDispatcher.dispatch({
          type: "MESSAGE_CREATE",
          channelId: cid,
          message: msg,
          optimistic: false,
          isPushNotification: false,
        });
      }
      if (withToast) toast("Replayed cached messages.");
    } catch (e) {
      if (withToast) toast(String(e?.message || e));
    }
  }

  function scheduleAutoReplay(cfg) {
    _autoReplayedThisSession = false;
    if (_fallbackTimer) {
      clearTimeout(_fallbackTimer);
      _fallbackTimer = null;
    }
    if (typeof _connUnsub === "function") {
      _connUnsub();
      _connUnsub = null;
    }

    const run = () => {
      if (_autoReplayedThisSession) return;
      ensureShape(cfg);
      if (!cfg.autoReplayOnLoad || !cfg.cached?.length) return;
      _autoReplayedThisSession = true;
      if (_fallbackTimer) {
        clearTimeout(_fallbackTimer);
        _fallbackTimer = null;
      }
      try {
        replayCached(cfg, false);
      } catch {
        /* ignore */
      }
    };

    _fallbackTimer = setTimeout(run, 6000);

    try {
      if (typeof FluxDispatcher.subscribe === "function") {
        const handler = () => setTimeout(run, 2000);
        FluxDispatcher.subscribe("CONNECTION_OPEN", handler);
        _connUnsub = () => {
          try {
            FluxDispatcher.unsubscribe?.("CONNECTION_OPEN", handler);
          } catch {
            /* ignore */
          }
        };
      }
    } catch {
      /* dispatcher not ready */
    }
  }

  function SettingsPanel() {
    const cfg = storage.useProxy(plugin.storage);
    ensureShape(cfg);

    const send = useCallback(() => {
      try {
        const payload = buildPayload(cfg);
        FluxDispatcher.dispatch(payload);
        const stored = cloneForStorage(payload.message);
        if (stored) cfg.cached.push(stored);
        toast("Local message injected.");
      } catch (e) {
        toast(String(e?.message || e));
      }
    }, [cfg]);

    const replay = useCallback(() => {
      replayCached(cfg, true);
    }, [cfg]);

    const clear = useCallback(() => {
      cfg.cached = [];
      toast("Cleared cache.");
    }, [cfg]);

    return React.createElement(
      ScrollView,
      { style: { flex: 1 }, contentContainerStyle: { paddingBottom: 80 } },
      React.createElement(
        Stack,
        { style: { paddingVertical: 24, paddingHorizontal: 16 }, spacing: 24 },
        React.createElement(
          TableRowGroup,
          { title: "Send local message" },
          React.createElement(InputRow, {
            label: "Target channel ID",
            value: cfg.channelId,
            onChange: (v) => {
              cfg.channelId = v;
            },
            placeholder: "Channel snowflake",
            isClearable: true,
          }),
          React.createElement(InputRow, {
            label: "Target user ID",
            value: cfg.userId,
            onChange: (v) => {
              cfg.userId = v;
            },
            placeholder: "User snowflake (author shown in UI)",
            isClearable: true,
          }),
          React.createElement(InputRow, {
            label: "Message content",
            value: cfg.message,
            onChange: (v) => {
              cfg.message = v;
            },
            placeholder: "Text (or embed body if preview is on)",
            isClearable: true,
          }),
          React.createElement(TableSwitchRow, {
            label: "Show embed preview",
            subLabel: "Use a rich embed for the message body",
            value: cfg.showEmbedPreview,
            onValueChange: (v) => {
              cfg.showEmbedPreview = v;
            },
          }),
          React.createElement(TableSwitchRow, {
            label: "Auto-replay after load",
            subLabel: "Re-inject saved messages when Discord finishes connecting",
            value: cfg.autoReplayOnLoad,
            onValueChange: (v) => {
              cfg.autoReplayOnLoad = v;
            },
          }),
          React.createElement(InputRow, {
            label: "Embed image URL",
            value: cfg.embedImageUrl,
            onChange: (v) => {
              cfg.embedImageUrl = v;
            },
            placeholder: "Main image for the embed",
            isClearable: true,
          }),
        ),
        React.createElement(
          TableRowGroup,
          { title: `Saved locally: ${cfg.cached?.length ?? 0} message(s)` },
          React.createElement(Button, {
            text: "Send message",
            variant: "primary",
            size: "md",
            onPress: send,
            style: { marginBottom: 8 },
          }),
          React.createElement(Button, {
            text: "Replay cached local messages",
            variant: "secondary",
            size: "md",
            onPress: replay,
            style: { marginBottom: 8 },
          }),
          React.createElement(Button, {
            text: "Clear cached local messages",
            variant: "secondary",
            size: "md",
            onPress: clear,
          }),
        ),
      ),
    );
  }

  const pluginApi = {
    onLoad() {
      const cfg = plugin.storage;
      ensureShape(cfg);
      scheduleAutoReplay(cfg);
    },
    onUnload() {
      if (_fallbackTimer) {
        clearTimeout(_fallbackTimer);
        _fallbackTimer = null;
      }
      if (typeof _connUnsub === "function") {
        _connUnsub();
        _connUnsub = null;
      }
    },
    settings: SettingsPanel,
  };

  // Match bundled plugins (e.g. TextReplace): Kettu/Revenge eval uses ret?.default ?? ret
  return { default: pluginApi };
})();
