import { api, dialogs, friendlyError } from "../api.ts";
import { t } from "../i18n/index.ts";
import { getConnectionMeta, setConnectionMeta, state } from "../state.ts";
import type { AuthKind, Connection, Session } from "../types.ts";
import { $, notify } from "../utils.ts";

export interface DialogCallbacks {
  onConnectionSaved: () => void;
  onSessionConnected: (sessionId: string, profile: Connection) => void;
}

let callbacks: DialogCallbacks = {
  onConnectionSaved: () => {},
  onSessionConnected: () => {},
};

let editingConnectionId: string | null = null;

function setAuthFieldsVisibility(isPrivateKey: boolean, isEditing: boolean): void {
  $("#password-field").classList.toggle("hidden", isPrivateKey);
  $("#private-key-field").classList.toggle("hidden", !isPrivateKey);
  $<HTMLInputElement>('[name="password"]').required = !isPrivateKey && !isEditing;
}

export function openConnectionDialog(profileToEdit?: Connection): void {
  const form = $<HTMLFormElement>("#connection-form");
  form.reset();
  editingConnectionId = profileToEdit?.id ?? null;

  const isEditing = Boolean(profileToEdit);
  $("#connection-dialog-eyebrow").textContent = isEditing ? t("conn.eyebrowEdit") : t("conn.eyebrowNew");
  $("#connection-dialog-title").textContent = t(isEditing ? "conn.titleEdit" : "conn.titleNew");
  $("#connection-submit-btn").textContent = t(isEditing ? "conn.updateBtn" : "conn.saveBtn");
  $("#password-label-text").textContent = t(isEditing ? "conn.passwordEdit" : "conn.password");
  $<HTMLInputElement>('[name="password"]').placeholder = t(
    isEditing ? "conn.passwordEditPlaceholder" : "conn.passwordPlaceholder",
  );

  if (profileToEdit) {
    const meta = getConnectionMeta(profileToEdit.id);
    $<HTMLInputElement>('[name="name"]').value = profileToEdit.name;
    $<HTMLInputElement>('[name="host"]').value = profileToEdit.host;
    $<HTMLInputElement>('[name="port"]').value = String(profileToEdit.port);
    $<HTMLInputElement>('[name="username"]').value = profileToEdit.username;
    $<HTMLInputElement>(`[name="auth"][value="${profileToEdit.auth}"]`).checked = true;
    $<HTMLInputElement>('[name="private_key_path"]').value = profileToEdit.private_key_path ?? "";
    $<HTMLInputElement>('[name="group"]').value = meta.group;
    $<HTMLInputElement>('[name="tags"]').value = meta.tags.join(", ");
    $<HTMLInputElement>('[name="timeout"]').value = meta.connect_timeout_secs
      ? String(meta.connect_timeout_secs)
      : "";
    $<HTMLInputElement>('[name="favorite"]').checked = meta.favorite;
    $<HTMLInputElement>('[name="auto_reconnect"]').checked = meta.auto_reconnect ?? true;
    setAuthFieldsVisibility(profileToEdit.auth === "private_key", true);
  } else {
    $<HTMLInputElement>('[name="port"]').value = "22";
    $<HTMLInputElement>('[name="auth"][value="password"]').checked = true;
    $<HTMLInputElement>('[name="auto_reconnect"]').checked = true;
    setAuthFieldsVisibility(false, false);
  }

  $("#form-error").textContent = "";
  $<HTMLDialogElement>("#connection-dialog").showModal();
  $<HTMLInputElement>('[name="name"]').focus();
}

function requestPassword(error: unknown): boolean {
  const discovered = state.discoveredHost;
  if (!discovered || discovered.profile.auth !== "password") return false;
  const message = friendlyError(error);
  if (!message.includes("密码")) return false;

  $("#password-entry").classList.remove("hidden");
  $("#connect-dialog").classList.add("password-needed");
  $("#connect-error").textContent = message;
  $<HTMLInputElement>("#connection-password").focus();
  return true;
}

export async function acceptHost(remember: boolean): Promise<void> {
  const discovered = state.discoveredHost;
  if (!discovered || state.connecting) return;

  state.connecting = true;
  const once = $<HTMLButtonElement>("#accept-once");
  const save = $<HTMLButtonElement>("#accept-save");
  once.disabled = true;
  save.disabled = true;
  $("#connect-error").textContent = "";
  once.textContent = t("host.connectingBtn");

  try {
    const password = $<HTMLInputElement>("#connection-password").value;
    const id = await api.connect({
      profileId: discovered.profile.id,
      hostKey: discovered.key.host_key,
      remember,
      password: password || null,
      savePassword: $<HTMLInputElement>("#remember-password").checked,
    });
    $<HTMLDialogElement>("#connect-dialog").close();
    callbacks.onSessionConnected(id, discovered.profile);
    notify(t("host.connectedNotify"));
  } catch (error) {
    if (!requestPassword(error)) {
      $("#connect-error").textContent = friendlyError(error);
    }
  } finally {
    state.connecting = false;
    once.disabled = false;
    once.textContent = t(discovered.known ? "host.connect" : "host.acceptOnce");
    save.disabled = discovered.known;
  }
}

export async function startConnectionWithConfirmation(
  profile: Connection,
  initialError: string | null,
): Promise<void> {
  if (state.connecting) return;
  state.connecting = true;

  const dialog = $<HTMLDialogElement>("#connect-dialog");
  dialog.dataset.profile = profile.id;
  $("#connect-target").textContent = `${profile.username}@${profile.host}:${profile.port}`;
  $("#connect-error").textContent = initialError ?? "";
  $("#host-dialog-title").textContent = t("host.fetchingTitle");
  $("#host-algorithm").textContent = t("host.fetchingValue");
  $("#host-fingerprint").textContent = t("host.fetchingValue");
  $("#host-notice").textContent = t("host.fetchingNotice");
  $("#password-entry").classList.add("hidden");
  $<HTMLInputElement>("#connection-password").value = "";
  dialog.classList.remove("password-needed");
  $<HTMLButtonElement>("#accept-once").disabled = true;
  $<HTMLButtonElement>("#accept-save").disabled = true;
  dialog.showModal();

  try {
    const key = await api.discoverHostKey(profile.id);
    const known = key.code === "host_key_known";
    state.discoveredHost = { profile, key, known };

    $("#host-dialog-title").textContent = known
      ? t("host.verifiedTitle")
      : key.changed
        ? t("host.changedTitle")
        : t("host.title");
    $("#host-algorithm").textContent = key.algorithm;
    $("#host-fingerprint").textContent = key.fingerprint;
    $("#host-notice").textContent = known
      ? t("host.verifiedNotice")
      : key.changed
        ? t("host.changedNotice", { fp: key.previous_fingerprint ?? "" })
        : t("host.unknownNotice");

    $("#accept-once").textContent = t(known ? "host.connect" : "host.acceptOnce");
    $<HTMLButtonElement>("#accept-once").disabled = false;
    $<HTMLButtonElement>("#accept-save").disabled = known;

    if (known && initialError === null) {
      state.connecting = false;
      await acceptHost(false);
    }
  } catch (error) {
    $("#host-dialog-title").textContent = t("host.failedTitle");
    $("#host-algorithm").textContent = "—";
    $("#host-fingerprint").textContent = "—";
    $("#host-notice").textContent = t("host.failedNotice");
    $("#connect-error").textContent = friendlyError(error);
  } finally {
    state.connecting = false;
  }
}

export async function openRemoteFile(
  session: Session,
  path: string,
  name: string,
  mode: "view" | "edit" = "edit",
): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  try {
    const text = await api.readTextFile(session.id, path);
    const dialog = $<HTMLDialogElement>("#editor-dialog");
    dialog.dataset.session = session.id;
    dialog.dataset.path = path;
    $("#editor-title").textContent = mode === "view" ? t("editor.quickViewName", { name }) : name;
    $("#editor-path").textContent = path;
    const editor = $<HTMLTextAreaElement>("#file-editor");
    editor.value = text;
    $("#editor-error").textContent = "";
    dialog.showModal();
    editor.focus();
  } catch (error) {
    notify(friendlyError(error), true);
  } finally {
    state.busy = false;
  }
}

async function saveEditorContents(): Promise<void> {
  const dialog = $<HTMLDialogElement>("#editor-dialog");
  const session = state.sessions.get(dialog.dataset.session ?? "");
  const remotePath = dialog.dataset.path;
  if (!session || !remotePath || state.busy) return;

  state.busy = true;
  $("#editor-error").textContent = "";
  const saveButton = $<HTMLButtonElement>("#save-remote-file");
  saveButton.disabled = true;

  try {
    await api.writeTextFile(session.id, remotePath, $<HTMLTextAreaElement>("#file-editor").value);
    dialog.close();
    notify(t("editor.saved"));
  } catch (error) {
    $("#editor-error").textContent = friendlyError(error);
  } finally {
    state.busy = false;
    saveButton.disabled = false;
  }
}

export function initDialogs(nextCallbacks: DialogCallbacks): void {
  callbacks = nextCallbacks;

  document.querySelectorAll<HTMLButtonElement>(".close-dialog").forEach(button =>
    button.addEventListener("click", () => button.closest("dialog")?.close()),
  );

  document.querySelectorAll<HTMLInputElement>('[name="auth"]').forEach(input =>
    input.addEventListener("change", () => {
      const privateKey = $<HTMLInputElement>('[name="auth"]:checked').value === "private_key";
      setAuthFieldsVisibility(privateKey, Boolean(editingConnectionId));
    }),
  );

  $("#choose-key").addEventListener("click", async () => {
    const path = await dialogs.pickPrivateKey();
    if (typeof path === "string") {
      $<HTMLInputElement>('[name="private_key_path"]').value = path;
    }
  });

  $("#connection-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const submitBtn = $<HTMLButtonElement>("#connection-submit-btn");
    submitBtn.disabled = true;

    const draft = {
      name: String(data.get("name") ?? ""),
      host: String(data.get("host") ?? ""),
      port: Number(data.get("port")),
      username: String(data.get("username") ?? ""),
      auth: (data.get("auth") as AuthKind) ?? "password",
      private_key_path: (data.get("private_key_path") as string) || null,
    };
    const password = (data.get("password") as string) || null;
    const timeoutRaw = Number(data.get("timeout"));
    const tags = String(data.get("tags") ?? "")
      .split(/[,，]/)
      .map(item => item.trim())
      .filter(Boolean);

    try {
      const profile = editingConnectionId
        ? await api.updateConnection(editingConnectionId, draft, password)
        : await api.saveConnection(draft, password);

      const previousMeta = getConnectionMeta(profile.id);
      setConnectionMeta(profile.id, {
        group: String(data.get("group") ?? "").trim(),
        tags,
        favorite: $<HTMLInputElement>('[name="favorite"]').checked,
        sort_order: previousMeta.sort_order,
        connect_timeout_secs:
          Number.isFinite(timeoutRaw) && timeoutRaw >= 3 ? Math.min(120, timeoutRaw) : null,
        auto_reconnect: $<HTMLInputElement>('[name="auto_reconnect"]').checked,
      });

      state.connections.set(profile.id, profile);
      callbacks.onConnectionSaved();
      $<HTMLDialogElement>("#connection-dialog").close();
      notify(t(editingConnectionId ? "conn.updatedNotify" : "conn.savedNotify"));
      editingConnectionId = null;
    } catch (error) {
      $("#form-error").textContent = String(error);
    } finally {
      submitBtn.disabled = false;
    }
  });

  $("#accept-once").addEventListener("click", () => void acceptHost(false));
  $("#accept-save").addEventListener("click", () => void acceptHost(true));

  $<HTMLInputElement>("#connection-password").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      void acceptHost(false);
    }
  });

  document.querySelectorAll<HTMLButtonElement>(".close-editor").forEach(button =>
    button.addEventListener("click", () => $<HTMLDialogElement>("#editor-dialog").close()),
  );

  $("#save-remote-file").addEventListener("click", () => void saveEditorContents());

  $<HTMLTextAreaElement>("#file-editor").addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveEditorContents();
    }
  });
}
