/**
 * Local message preview — presets use the same UX as TextReplace (rules list + edit subpage).
 * Kettu: vendetta=>{ return <this file> } — file is an expression (IIFE).
 */
(() => {
  const v = typeof vendetta !== "undefined" && vendetta ? vendetta : {};
  const metro = v.metro;
  const common = metro?.common || {};
  const React = common.React;
  const useCallback = React?.useCallback;
  const useEffect = React?.useEffect;
  const useRef = React?.useRef;
  const useState = React?.useState;
  const { FluxDispatcher } = common;
  const uiRoot = v.ui || {};
  const assets = uiRoot.assets;
  const toastRaw = uiRoot.toasts && uiRoot.toasts.showToast;
  const toast = (m, icon) => {
    try {
      if (typeof toastRaw === "function") toastRaw(m, icon);
    } catch (_) {}
  };
  const storage = v.storage;
  const plugin = v.plugin;
  const alerts = v.alerts;
  const getAsset = (n) => assets?.getAssetIDByName?.(n);
  const clipboard = common.clipboard;

  /** Kettu uses PUPU_CUSTOM_PAGE; Revenge/Vendetta often use VendettaCustomPage. Prefer PUPU when both exist. */
  function pushSubPage(navigation, title, render) {
    const payload = { title, render };
    let route = "PUPU_CUSTOM_PAGE";
    try {
      const rn = navigation.getState?.()?.routeNames;
      if (Array.isArray(rn)) {
        if (rn.includes("PUPU_CUSTOM_PAGE")) route = "PUPU_CUSTOM_PAGE";
        else if (rn.includes("VendettaCustomPage")) route = "VendettaCustomPage";
      }
    } catch (_) {}
    try {
      navigation.push(route, payload);
    } catch (_) {
      try {
        navigation.push(route === "PUPU_CUSTOM_PAGE" ? "VendettaCustomPage" : "PUPU_CUSTOM_PAGE", payload);
      } catch (_) {}
    }
  }

  function resolvePluginUi() {
    const RN = common.ReactNative || {};
    const comps = common.components || {};
    const findRedesign = (name) => metro.findByProps(name)?.[name];
    const TextInput = findRedesign("TextInput");
    const Button = findRedesign("Button");
    const hasTable = !!(
      comps.TableRow &&
      comps.TableRowGroup &&
      comps.Stack &&
      comps.TableSwitchRow &&
      TextInput &&
      Button
    );
    const Forms = uiRoot.components?.Forms;
    const legacyButton = uiRoot.components?.Button;
    const hasForms = !!(
      Forms?.FormInput &&
      Forms?.FormSection &&
      Forms?.FormSwitch &&
      legacyButton
    );
    const alertModals = metro.findByProps("AlertModal", "AlertActions");
    return {
      hasTable,
      hasForms,
      TableRow: comps.TableRow,
      TableRowGroup: comps.TableRowGroup,
      Stack: comps.Stack,
      TableSwitchRow: comps.TableSwitchRow,
      TextInput,
      Button,
      Forms,
      legacyButton,
      View: RN.View,
      ScrollView: RN.ScrollView,
      Text: RN.Text,
      TextInputRN: RN.TextInput,
      Pressable: RN.Pressable,
      Keyboard: RN.Keyboard,
      AlertModal: alertModals?.AlertModal,
      AlertActions: alertModals?.AlertActions,
      AlertActionButton: alertModals?.AlertActionButton,
      openAlert: metro.findByProps("openAlert", "dismissAlert")?.openAlert,
      dismissAlert: metro.findByProps("openAlert", "dismissAlert")?.dismissAlert,
    };
  }

  function defaultPreset(name) {
    return {
      name: name || "New preset",
      channelId: "",
      userId: "",
      message: "",
      showEmbedPreview: false,
      embedImageUrl: "",
    };
  }

  function ensureRule(r) {
    if (typeof r.name !== "string") r.name = "Preset";
    if (typeof r.channelId !== "string") r.channelId = "";
    if (typeof r.userId !== "string") r.userId = "";
    if (typeof r.message !== "string") r.message = "";
    if (typeof r.showEmbedPreview !== "boolean") r.showEmbedPreview = false;
    if (typeof r.embedImageUrl !== "string") r.embedImageUrl = "";
  }

  /** Root storage: rules[], cached[], autoReplayOnLoad; migrate legacy flat fields. */
  function ensureRoot(st) {
    if (!Array.isArray(st.rules)) st.rules = [];
    if (!Array.isArray(st.cached)) st.cached = [];
    if (typeof st.autoReplayOnLoad !== "boolean") st.autoReplayOnLoad = true;

    const legacy =
      st.rules.length === 0 &&
      (typeof st.channelId === "string" || typeof st.userId === "string" || typeof st.message === "string");
    if (legacy) {
      st.rules.push(
        defaultPreset("Default"),
      );
      const r = st.rules[0];
      r.channelId = typeof st.channelId === "string" ? st.channelId : "";
      r.userId = typeof st.userId === "string" ? st.userId : "";
      r.message = typeof st.message === "string" ? st.message : "";
      r.showEmbedPreview = !!st.showEmbedPreview;
      r.embedImageUrl = typeof st.embedImageUrl === "string" ? st.embedImageUrl : "";
      delete st.channelId;
      delete st.userId;
      delete st.message;
      delete st.showEmbedPreview;
      delete st.embedImageUrl;
    }
    for (const rule of st.rules) ensureRule(rule);
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

  function buildPayload(rule) {
    ensureRule(rule);
    const channelId = rule.channelId.trim();
    const userId = rule.userId.trim();
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
    const text = rule.message ?? "";

    const embeds =
      rule.showEmbedPreview && text.trim().length > 0
        ? [
            {
              type: "rich",
              description: text,
              ...(rule.embedImageUrl?.trim()
                ? {
                    image: {
                      url: rule.embedImageUrl.trim(),
                      proxy_url: rule.embedImageUrl.trim(),
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
      content: rule.showEmbedPreview ? "" : text,
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

  function replayCached(st, withToast = true) {
    try {
      ensureRoot(st);
      for (const msg of st.cached) {
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

  function scheduleAutoReplay(st) {
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
      ensureRoot(st);
      if (!st.autoReplayOnLoad || !st.cached?.length) return;
      _autoReplayedThisSession = true;
      if (_fallbackTimer) {
        clearTimeout(_fallbackTimer);
        _fallbackTimer = null;
      }
      try {
        replayCached(st, false);
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

  function commitRuleAtIndex(st, ruleIndex, nextRule) {
    if (!st.rules[ruleIndex]) return;
    const copy = [...st.rules];
    copy[ruleIndex] = { ...nextRule };
    ensureRule(copy[ruleIndex]);
    st.rules = copy;
  }

  function deleteRuleAtIndex(st, ruleIndex) {
    const copy = [...st.rules];
    copy.splice(ruleIndex, 1);
    st.rules = copy;
  }

  /** TextReplace-style editor: local state + commit on leave + delete + copy JSON + send now */
  function EditPreset({ ruleIndex }) {
    const st = storage.useProxy(plugin.storage);
    ensureRoot(st);
    const initial = st.rules[ruleIndex];
    if (!initial) return null;

    const ui = resolvePluginUi();
    const navigation = common.NavigationNative.useNavigation();
    const [local, setLocal] = useState({ ...initial });
    const ruleRef = useRef(local);
    const isDeletingRef = useRef(false);
    const [keyboardHeight, setKeyboardHeight] = useState(0);

    useEffect(() => {
      ruleRef.current = local;
    }, [local]);

    useEffect(() => {
      const kb = common.ReactNative.Keyboard;
      if (!kb?.addListener) return undefined;
      const s = kb.addListener("keyboardDidShow", (e) => setKeyboardHeight(e.endCoordinates?.height || 0));
      const h = kb.addListener("keyboardDidHide", () => setKeyboardHeight(0));
      return () => {
        s.remove();
        h.remove();
      };
    }, []);

    useEffect(() => {
      const unsub = navigation.addListener("beforeRemove", () => {
        if (isDeletingRef.current || !st.rules[ruleIndex]) return;
        commitRuleAtIndex(st, ruleIndex, ruleRef.current);
      });
      return unsub;
    }, [navigation, ruleIndex]);

    const updateField = (key, value) => {
      setLocal((prev) => {
        const n = { ...prev, [key]: value };
        ruleRef.current = n;
        return n;
      });
    };

    const sendNow = useCallback(() => {
      try {
        const payload = buildPayload(ruleRef.current);
        FluxDispatcher.dispatch(payload);
        const stored = cloneForStorage(payload.message);
        if (stored) st.cached.push(stored);
        toast("Local message injected.");
      } catch (e) {
        toast(String(e?.message || e));
      }
    }, [st]);

    const copyJson = useCallback(() => {
      try {
        const body = JSON.stringify(ruleRef.current, null, 2);
        clipboard?.setString?.(`\`\`\`json\n${body}\n\`\`\``);
        toast("Preset copied (JSON in markdown).", getAsset("CopyIcon"));
      } catch (_) {
        toast("Copy failed.");
      }
    }, []);

    const doDelete = () => {
      isDeletingRef.current = true;
      deleteRuleAtIndex(st, ruleIndex);
      navigation.goBack();
    };

    const confirmDelete = () => {
      if (alerts?.showConfirmationAlert) {
        alerts.showConfirmationAlert({
          title: "Delete preset?",
          content: "This cannot be undone.",
          confirmText: "Delete",
          confirmColor: "red",
          cancelText: "Cancel",
          onConfirm: doDelete,
        });
        return;
      }
      if (ui.openAlert && ui.AlertModal && ui.AlertActions && ui.AlertActionButton) {
        const id = "lmp-delete-preset";
        ui.openAlert(
          id,
          React.createElement(ui.AlertModal, {
            title: "Delete preset?",
            content: "This cannot be undone.",
            actions: React.createElement(
              ui.AlertActions,
              null,
              React.createElement(ui.AlertActionButton, {
                text: "Cancel",
                variant: "secondary",
                onPress: () => ui.dismissAlert?.(id),
              }),
              React.createElement(ui.AlertActionButton, {
                text: "Delete",
                variant: "destructive",
                onPress: () => {
                  ui.dismissAlert?.(id);
                  doDelete();
                },
              }),
            ),
          }),
        );
        return;
      }
      doDelete();
    };

    function tableInputRow(label, field, placeholder) {
      return React.createElement(ui.TableRow, {
        label,
        subLabel: React.createElement(
          ui.View,
          { style: { marginTop: 8 } },
          React.createElement(ui.TextInput, {
            placeholder,
            value: local[field],
            onChange: (v) => updateField(field, v),
            isClearable: true,
          }),
        ),
      });
    }

    if (ui.hasTable) {
      return React.createElement(
        ui.ScrollView,
        {
          style: { flex: 1 },
          contentContainerStyle: { paddingBottom: keyboardHeight + 24 },
          keyboardShouldPersistTaps: "handled",
        },
        React.createElement(
          ui.Stack,
          { style: { paddingVertical: 24, paddingHorizontal: 16 }, spacing: 24 },
          React.createElement(
            ui.TableRowGroup,
            { title: "Preset" },
            tableInputRow("Name", "name", "Label for this preset"),
            tableInputRow("Channel ID", "channelId", "Channel snowflake"),
            tableInputRow("User ID", "userId", "Author user snowflake"),
            tableInputRow("Message", "message", "Text or embed body"),
            React.createElement(ui.TableSwitchRow, {
              label: "Embed preview",
              subLabel: "Show message as a rich embed",
              value: local.showEmbedPreview,
              onValueChange: (v) => updateField("showEmbedPreview", v),
            }),
            tableInputRow("Embed image URL", "embedImageUrl", "Optional image URL"),
          ),
          React.createElement(
            ui.TableRowGroup,
            { title: "Actions" },
            React.createElement(ui.TableRow, {
              label: "Send now (local only)",
              ...(ui.TableRow.Icon
                ? {
                    icon: React.createElement(ui.TableRow.Icon, {
                      source: getAsset("SendIcon") || getAsset("ArrowRightIcon"),
                    }),
                  }
                : {}),
              onPress: sendNow,
              arrow: true,
            }),
            React.createElement(ui.TableRow, {
              label: "Copy preset JSON",
              ...(ui.TableRow.Icon
                ? { icon: React.createElement(ui.TableRow.Icon, { source: getAsset("CopyIcon") }) }
                : {}),
              onPress: copyJson,
              arrow: true,
            }),
            React.createElement(ui.TableRow, {
              label: "Delete preset",
              ...(ui.TableRow.Icon
                ? {
                    icon: React.createElement(ui.TableRow.Icon, {
                      source: getAsset("TrashIcon"),
                      variant: "danger",
                    }),
                  }
                : {}),
              onPress: confirmDelete,
              variant: "danger",
              arrow: true,
            }),
          ),
        ),
      );
    }

    if (ui.hasForms) {
      const { FormSection, FormInput, FormSwitch } = ui.Forms;
      const Btn = ui.legacyButton;
      return React.createElement(
        ui.ScrollView,
        { style: { flex: 1 }, contentContainerStyle: { paddingBottom: keyboardHeight + 24 } },
        React.createElement(
          FormSection,
          { title: "Preset" },
          React.createElement(FormInput, {
            title: "Name",
            value: local.name,
            onChange: (v) => updateField("name", v),
            placeholder: "Label",
          }),
          React.createElement(FormInput, {
            title: "Channel ID",
            value: local.channelId,
            onChange: (v) => updateField("channelId", v),
            placeholder: "Channel snowflake",
          }),
          React.createElement(FormInput, {
            title: "User ID",
            value: local.userId,
            onChange: (v) => updateField("userId", v),
            placeholder: "User snowflake",
          }),
          React.createElement(FormInput, {
            title: "Message",
            value: local.message,
            onChange: (v) => updateField("message", v),
            placeholder: "Message text",
          }),
          React.createElement(FormSwitch, {
            label: "Embed preview",
            value: local.showEmbedPreview,
            onValueChange: (v) => updateField("showEmbedPreview", v),
          }),
          React.createElement(FormInput, {
            title: "Embed image URL",
            value: local.embedImageUrl,
            onChange: (v) => updateField("embedImageUrl", v),
            placeholder: "Optional",
          }),
        ),
        React.createElement(
          FormSection,
          { title: "Actions" },
          React.createElement(Btn, { text: "Send now", onPress: sendNow, style: { marginBottom: 8 } }),
          React.createElement(Btn, { text: "Copy JSON", onPress: copyJson, style: { marginBottom: 8 } }),
          React.createElement(Btn, { text: "Delete preset", onPress: confirmDelete }),
        ),
      );
    }

    const tiStyle = {
      borderWidth: 1,
      borderColor: "#555",
      borderRadius: 8,
      padding: 10,
      marginBottom: 10,
      color: "#fff",
    };
    const labelStyle = { color: "#ddd", marginBottom: 4, fontSize: 13 };
    const btnStyle = {
      backgroundColor: "#5865f2",
      padding: 12,
      borderRadius: 8,
      marginBottom: 8,
      alignItems: "center",
    };
    const row = (label, field, multiline) =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(ui.Text, { style: labelStyle }, label),
        React.createElement(ui.TextInputRN, {
          style: tiStyle,
          value: local[field],
          onChangeText: (t) => updateField(field, t),
          placeholder: label,
          placeholderTextColor: "#888",
          multiline: !!multiline,
        }),
      );

    return React.createElement(
      ui.ScrollView,
      {
        style: { flex: 1 },
        contentContainerStyle: { padding: 16, paddingBottom: keyboardHeight + 48 },
        keyboardShouldPersistTaps: "handled",
      },
      row("Name", "name", false),
      row("Channel ID", "channelId", false),
      row("User ID", "userId", false),
      row("Message", "message", true),
      React.createElement(ui.Text, { style: labelStyle }, `Embed preview: ${local.showEmbedPreview ? "on" : "off"}`),
      React.createElement(
        ui.Pressable,
        {
          onPress: () => updateField("showEmbedPreview", !local.showEmbedPreview),
          style: btnStyle,
        },
        React.createElement(ui.Text, { style: { color: "#fff", fontWeight: "600" } }, "Toggle embed preview"),
      ),
      row("Embed image URL", "embedImageUrl", false),
      React.createElement(
        ui.Pressable,
        { onPress: sendNow, style: btnStyle },
        React.createElement(ui.Text, { style: { color: "#fff", fontWeight: "600" } }, "Send now"),
      ),
      React.createElement(
        ui.Pressable,
        { onPress: copyJson, style: btnStyle },
        React.createElement(ui.Text, { style: { color: "#fff", fontWeight: "600" } }, "Copy JSON"),
      ),
      React.createElement(
        ui.Pressable,
        {
          onPress: confirmDelete,
          style: { ...btnStyle, backgroundColor: "#ed4245" },
        },
        React.createElement(ui.Text, { style: { color: "#fff", fontWeight: "600" } }, "Delete preset"),
      ),
    );
  }

  function SettingsPanel() {
    const st = storage.useProxy(plugin.storage);
    ensureRoot(st);
    const ui = resolvePluginUi();
    if (typeof common.NavigationNative?.useNavigation !== "function") {
      return React.createElement(
        ui.ScrollView,
        { style: { flex: 1 }, contentContainerStyle: { padding: 20 } },
        React.createElement(
          ui.Text,
          { style: { color: "#f04747" } },
          "Navigation is not available here. Open Configure from Plugins (wrench) with the plugin enabled, and turn off Safe Mode if it is on.",
        ),
      );
    }
    const navigation = common.NavigationNative.useNavigation();

    const openEditor = (index) => {
      pushSubPage(navigation, "Edit preset", () =>
        React.createElement(EditPreset, { ruleIndex: index }),
      );
    };

    const createPreset = () => {
      const next = defaultPreset("New preset");
      st.rules = [...st.rules, next];
      openEditor(st.rules.length - 1);
    };

    const replay = useCallback(() => replayCached(st, true), [st]);
    const clearCache = useCallback(() => {
      st.cached = [];
      toast("Cleared cache.");
    }, [st]);

    if (ui.hasTable) {
      return React.createElement(
        ui.View,
        { style: { flex: 1 } },
        React.createElement(
          ui.ScrollView,
          { contentContainerStyle: { paddingBottom: 80 } },
          React.createElement(
            ui.Stack,
            { style: { paddingVertical: 24, paddingHorizontal: 16 }, spacing: 24 },
            React.createElement(
              ui.TableRowGroup,
              { title: "Presets" },
              st.rules.length === 0
                ? React.createElement(
                    ui.View,
                    { style: { padding: 16, alignItems: "center" } },
                    React.createElement(ui.Text, { style: { color: "#999", textAlign: "center" } }, "No presets yet."),
                  )
                : st.rules.map((rule, i) =>
                    React.createElement(ui.TableRow, {
                      key: i,
                      label: rule.name || "Unnamed",
                      subLabel:
                        rule.channelId && rule.userId
                          ? `${rule.channelId.slice(0, 6)}… · ${rule.userId.slice(0, 6)}…`
                          : "Set channel & user IDs",
                      onPress: () => openEditor(i),
                      arrow: true,
                    }),
                  ),
            ),
            React.createElement(
              ui.Button,
              {
                text: "New preset",
                variant: "primary",
                size: "md",
                onPress: createPreset,
                icon: getAsset("PlusSmallIcon"),
                iconPosition: "start",
              },
            ),
            React.createElement(
              ui.TableRowGroup,
              { title: "Replay & cache" },
              React.createElement(ui.TableSwitchRow, {
                label: "Auto-replay cached after load",
                subLabel: "Re-inject saved messages when Discord connects",
                value: st.autoReplayOnLoad,
                onValueChange: (v) => {
                  st.autoReplayOnLoad = v;
                },
              }),
              React.createElement(ui.TableRow, {
                label: `Cached messages: ${st.cached?.length ?? 0}`,
                subLabel: "From “Send now” on presets",
                onPress: replay,
                arrow: true,
              }),
              React.createElement(ui.TableRow, {
                label: "Clear cached messages",
                onPress: clearCache,
                arrow: true,
              }),
            ),
          ),
        ),
      );
    }

    if (ui.hasForms) {
      const { FormSection, FormSwitch } = ui.Forms;
      const Btn = ui.legacyButton;
      const presetButtons =
        st.rules.length === 0
          ? [
              React.createElement(
                Btn,
                { key: "empty", text: "No presets — tap to add", onPress: createPreset },
              ),
            ]
          : st.rules.map((rule, i) =>
              React.createElement(Btn, {
                key: i,
                text: rule.name || `Preset ${i + 1}`,
                onPress: () => openEditor(i),
                style: { marginBottom: 8 },
              }),
            );
      return React.createElement(
        ui.ScrollView,
        { style: { flex: 1 }, contentContainerStyle: { paddingBottom: 48 } },
        React.createElement(FormSection, { title: "Presets" }, ...presetButtons),
        React.createElement(Btn, {
          text: "New preset",
          onPress: createPreset,
          style: { marginHorizontal: 16, marginBottom: 16 },
        }),
        React.createElement(
          FormSection,
          { title: "Replay & cache" },
          React.createElement(FormSwitch, {
            label: "Auto-replay cached after load",
            value: st.autoReplayOnLoad,
            onValueChange: (v) => {
              st.autoReplayOnLoad = v;
            },
          }),
          React.createElement(Btn, { text: "Replay cached now", onPress: replay, style: { marginTop: 8 } }),
          React.createElement(Btn, { text: "Clear cache", onPress: clearCache, style: { marginTop: 8 } }),
        ),
      );
    }

    /* Minimal fallback: list + buttons */
    const labelStyle = { color: "#ddd", marginBottom: 6, fontSize: 14 };
    const btnStyle = {
      backgroundColor: "#5865f2",
      padding: 12,
      borderRadius: 8,
      marginBottom: 8,
      alignItems: "center",
    };
    return React.createElement(
      ui.ScrollView,
      { style: { flex: 1 }, contentContainerStyle: { padding: 16, paddingBottom: 48 } },
      React.createElement(ui.Text, { style: { color: "#aaa", marginBottom: 12 } }, "Presets"),
      ...st.rules.map((rule, i) =>
        React.createElement(
          ui.Pressable,
          {
            key: i,
            onPress: () => openEditor(i),
            style: {
              padding: 12,
              borderWidth: 1,
              borderColor: "#444",
              borderRadius: 8,
              marginBottom: 8,
            },
          },
          React.createElement(ui.Text, { style: { color: "#fff", fontWeight: "600" } }, rule.name || "Unnamed"),
          React.createElement(ui.Text, { style: { color: "#888", fontSize: 12 } }, rule.channelId || "—"),
        ),
      ),
      React.createElement(
        ui.Pressable,
        { onPress: createPreset, style: btnStyle },
        React.createElement(ui.Text, { style: { color: "#fff", fontWeight: "600" } }, "New preset"),
      ),
      React.createElement(ui.Text, { style: { ...labelStyle, marginTop: 16 } }, "Replay & cache"),
      React.createElement(
        ui.Pressable,
        {
          onPress: () => {
            st.autoReplayOnLoad = !st.autoReplayOnLoad;
            toast(`Auto-replay: ${st.autoReplayOnLoad ? "on" : "off"}`);
          },
          style: btnStyle,
        },
        React.createElement(ui.Text, { style: { color: "#fff" } }, `Auto-replay: ${st.autoReplayOnLoad ? "on" : "off"}`),
      ),
      React.createElement(
        ui.Pressable,
        { onPress: replay, style: btnStyle },
        React.createElement(ui.Text, { style: { color: "#fff" } }, "Replay cached"),
      ),
      React.createElement(
        ui.Pressable,
        { onPress: clearCache, style: { ...btnStyle, backgroundColor: "#ed4245" } },
        React.createElement(ui.Text, { style: { color: "#fff" } }, "Clear cache"),
      ),
    );
  }

  const hooksOk =
    typeof React?.createElement === "function" &&
    typeof useCallback === "function" &&
    typeof useEffect === "function" &&
    typeof useRef === "function" &&
    typeof useState === "function" &&
    typeof storage?.useProxy === "function" &&
    plugin?.storage != null;

  function SettingsPanelFallback() {
    const T = common.ReactNative?.Text;
    const msg =
      "LocalMessagePreview could not bind to this client. Missing: " +
      [
        !React?.createElement && "React",
        typeof useState !== "function" && "hooks",
        typeof storage?.useProxy !== "function" && "storage.useProxy",
        !plugin?.storage && "plugin.storage",
      ]
        .filter(Boolean)
        .join(", ");
    return T
      ? React.createElement(T, { style: { padding: 20, color: "#f04747" } }, msg)
      : null;
  }

  const pluginApi = {
    onLoad() {
      try {
        const st = plugin.storage;
        ensureRoot(st);
        scheduleAutoReplay(st);
      } catch (e) {
        try {
          toast(String(e?.message || e));
        } catch (_) {}
      }
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
    settings: hooksOk ? SettingsPanel : SettingsPanelFallback,
  };

  pluginApi.default = pluginApi;
  return pluginApi;
})();
